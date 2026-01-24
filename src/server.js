import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import ofx from 'node-ofx-parser';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();

app.use(express.json({ limit: '50mb' })); 
app.use(cors());
app.use(express.static('public'));

const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// FUNÇÃO AUXILIAR: CHECAR DUPLICIDADE
// ==========================================
async function checarDuplicidade(usuarioId, transacoes) {
    if (!usuarioId) return transacoes;

    return await Promise.all(transacoes.map(async (t) => {
        const dataExata = new Date(t.data + "T12:00:00");
        const termoBusca = (t.fornecedor || t.descricao || "").split(' ')[0]; // Pega 1º nome

        if (!termoBusca) return { ...t, duplicata: false };

        const duplicata = await prisma.transacao.findFirst({
            where: {
                usuarioId: usuarioId,
                valor: t.valor,
                data: { equals: dataExata },
                OR: [
                    { fornecedor: { contains: termoBusca } },
                    { descricao: { contains: termoBusca } }
                ]
            }
        });

        if (duplicata) {
            const dia = duplicata.data.getDate().toString().padStart(2, '0');
            const mes = (duplicata.data.getMonth() + 1).toString().padStart(2, '0');
            const nome = duplicata.fornecedor || duplicata.descricao;
            return { 
                ...t, 
                duplicata: true, 
                duplicataInfo: `${nome} (${dia}/${mes})` 
            };
        }
        return { ...t, duplicata: false };
    }));
}

// ==========================================
// 1. ROTAS DE TRANSAÇÕES
// ==========================================
app.post('/transacoes', async (req, res) => {
    try {
        const { descricao, valor, tipo, categoria, status, data, dataPagamento, bancoId, usuarioId, fornecedor, formaPagamento, parcelas, itensParcelados } = req.body;
        if (!usuarioId) return res.status(400).json({ erro: "ID obrigatório" });

        const criadas = [];

        if (itensParcelados && itensParcelados.length > 0) {
            for (const item of itensParcelados) {
                const dt = new Date(`${item.data}T12:00:00`);
                criadas.push(await prisma.transacao.create({
                    data: {
                        fornecedor: fornecedor || descricao,
                        descricao: item.descricao,
                        valor: parseFloat(item.valor),
                        tipo,
                        categoria: categoria || 'Geral',
                        status: 'PENDENTE',
                        formaPagamento: item.formaPagamento || "Outros",
                        data: dt, dataVencimento: dt,
                        banco: (bancoId) ? { connect: { id: bancoId } } : undefined,
                        usuario: { connect: { id: usuarioId } }
                    }
                }));
            }
        } else {
            let dt = new Date();
            if (data) dt = new Date(data.includes('T') ? data : `${data}T12:00:00`);
            
            let dtPg = null;
            if (dataPagamento) dtPg = new Date(dataPagamento.includes('T') ? dataPagamento : `${dataPagamento}T12:00:00`);

            criadas.push(await prisma.transacao.create({
                data: {
                    fornecedor: fornecedor || descricao,
                    descricao,
                    valor: parseFloat(valor),
                    tipo,
                    categoria: categoria || 'Geral',
                    status: status || 'PENDENTE',
                    formaPagamento: formaPagamento || "Outros",
                    data: dt, dataVencimento: dt, dataPagamento: dtPg,
                    parcelas: 1,
                    banco: (bancoId) ? { connect: { id: bancoId } } : undefined,
                    usuario: { connect: { id: usuarioId } }
                }
            }));
        }
        res.json(criadas[0]);
    } catch (e) { res.status(500).json({ erro: "Erro ao salvar" }); }
});

app.get('/transacoes', async (req, res) => {
    const { tipo, status, usuarioId } = req.query;
    const where = {};
    if(tipo) where.tipo = tipo;
    if(status) where.status = status;
    if(usuarioId) where.usuarioId = usuarioId;
    
    const lista = await prisma.transacao.findMany({ where, include: { banco: true }, orderBy: { data: 'desc' } });
    res.json(lista);
});

app.put('/transacoes/:id', async (req, res) => {
    const { id } = req.params;
    const body = req.body;
    try {
        let dados = {};
        if (body.status === 'PENDENTE' && !body.bancoId) {
            const tr = await prisma.transacao.findUnique({ where: { id } });
            dados = { status: 'PENDENTE', banco: { disconnect: true }, dataPagamento: null, valor: tr.valorOriginal || tr.valor, valorOriginal: null };
        } else if (body.status === 'PAGO' || body.status === 'RECEBIDO') {
            const tr = await prisma.transacao.findUnique({ where: { id } });
            dados = { 
                status: body.status, 
                banco: { connect: { id: body.bancoId } }, 
                dataPagamento: new Date(body.dataPagamento), 
                valor: parseFloat(body.valorFinal || body.valor),
                valorOriginal: tr.valorOriginal || tr.valor 
            };
        } else {
            dados = { ...body };
            if(body.dataVencimento) {
                const dt = new Date(body.dataVencimento.includes('T') ? body.dataVencimento : `${body.dataVencimento}T12:00:00`);
                dados.dataVencimento = dt; dados.data = dt;
            }
            if(body.valor) dados.valor = parseFloat(body.valor);
        }
        const atualizado = await prisma.transacao.update({ where: { id }, data: dados });
        res.json(atualizado);
    } catch (e) { res.status(500).json({ erro: "Erro ao atualizar" }); }
});

app.delete('/transacoes/:id', async (req, res) => {
    try { await prisma.transacao.delete({ where: { id: req.params.id } }); res.status(204).send(); } catch(e) { res.status(500).send(); }
});

app.put('/transacoes/:id/baixar', async (req, res) => {
    const { id } = req.params;
    const { bancoId, dataPagamento, valorPago } = req.body;
    try {
        const tr = await prisma.transacao.findUnique({ where: { id } });
        const status = tr.tipo === 'DESPESA' ? 'PAGO' : 'RECEBIDO';
        const dt = new Date(dataPagamento.includes('T') ? dataPagamento : `${dataPagamento}T12:00:00`);
        const up = await prisma.transacao.update({
            where: { id },
            data: { status, bancoId, dataPagamento: dt, valor: parseFloat(valorPago), valorOriginal: tr.valor }
        });
        res.json(up);
    } catch(e) { res.status(500).json({ erro: "Erro na baixa" }); }
});

// ==========================================
// 2. IMPORTAÇÃO INTELIGENTE (CSV + OFX)
// ==========================================
app.post('/importar/ler-csv', async (req, res) => {
    try {
        const { conteudo, usuarioId } = req.body;
        if (!conteudo) return res.status(400).json({ erro: "Vazio" });

        const linhas = conteudo.split(/\r?\n/);
        const lista = [];

        for (let i = 1; i < linhas.length; i++) {
            const cols = linhas[i].split(';');
            if (cols.length < 5) continue;

            const fornecedor = cols[0];
            const dataRaw = cols[1];
            const total = parseInt(cols[3]) || 1;
            const atual = parseInt(cols[4]) || 1;
            const valor = parseFloat(cols[5].replace('R$', '').replace(/\./g, '').replace(',', '.').trim());

            if(!fornecedor || !dataRaw) continue;

            const [d, m, y] = dataRaw.split('/');
            const dataBase = new Date(y, m-1, d, 12, 0, 0);

            for (let p = atual; p <= total; p++) {
                const dt = new Date(dataBase);
                dt.setMonth(dataBase.getMonth() + (p - atual));
                const dataIso = dt.toISOString().split('T')[0];

                let desc = fornecedor;
                let info = "1/1";
                if(total > 1) { desc = `${fornecedor} (${p}/${total})`; info = `${p}/${total}`; }

                lista.push({
                    data: dataIso, descricao: desc, fornecedor, valor,
                    tipo: 'DESPESA', parcelas: total, parcelaInfo: info,
                    id_transacao: `csv-${i}-${p}`
                });
            }
        }
        const verificados = await checarDuplicidade(usuarioId, lista);
        res.json(verificados);
    } catch (e) { console.error(e); res.status(500).json({ erro: "Erro CSV" }); }
});

app.post('/conciliacao/ler-ofx', upload.single('arquivo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ erro: "Sem arquivo" });
        const usuarioId = req.body.usuarioId;
        const txt = req.file.buffer.toString('utf8');
        let lista = [];

        if (txt.trim().startsWith('{')) { // JSON
            try {
                const json = JSON.parse(txt);
                if(json.data) lista = json.data.map(t => ({
                    data: t.dateTime.split('T')[0],
                    descricao: t.title,
                    valor: Math.abs(t.rawAmount/100),
                    tipo: t.direction === 'in' ? 'RECEITA' : 'DESPESA'
                }));
            } catch(e){}
        } 
        
        if (lista.length === 0) { // OFX
            const data = ofx.parse(txt);
            let raw = data.OFX?.BANKMSGSRSV1?.STMTTRNRS?.STMTRS?.BANKTRANLIST?.STMTTRN 
                   || data.OFX?.CREDITCARDMSGSRSV1?.CCSTMTTRNRS?.CCSTMTRS?.BANKTRANLIST?.STMTTRN;
            if(raw) {
                if(!Array.isArray(raw)) raw = [raw];
                lista = raw.map(t => {
                    const d = t.DTPOSTED.substring(0,8);
                    const dt = `${d.substring(0,4)}-${d.substring(4,6)}-${d.substring(6,8)}`;
                    const v = parseFloat(String(t.TRNAMT).replace(',', '.'));
                    return { data: dt, descricao: t.MEMO, valor: Math.abs(v), tipo: v<0 ? 'DESPESA' : 'RECEITA' };
                });
            }
        }

        const verificados = await checarDuplicidade(usuarioId, lista);
        res.json({ transacoes: verificados });
    } catch (e) { res.status(500).json({ erro: "Erro OFX" }); }
});

// ==========================================
// 3. ROTAS DE USUÁRIOS (RESTAURADAS!)
// ==========================================
app.get('/usuarios', async (req, res) => {
    try {
        const usuarios = await prisma.usuario.findMany({
            select: { id: true, nome: true, email: true, role: true },
            orderBy: { nome: 'asc' }
        });
        res.json(usuarios);
    } catch (e) { res.status(500).json({ erro: "Erro ao buscar usuários" }); }
});

app.patch('/usuarios/:id/role', async (req, res) => {
    try {
        const usuario = await prisma.usuario.update({
            where: { id: req.params.id },
            data: { role: req.body.role }
        });
        res.json(usuario);
    } catch (e) { res.status(500).json({ erro: "Erro ao alterar permissão" }); }
});

app.delete('/usuarios/:id', async (req, res) => {
    try {
        await prisma.usuario.delete({ where: { id: req.params.id } });
        res.status(204).send();
    } catch (e) { res.status(500).json({ erro: "Erro ao excluir" }); }
});

app.put('/usuarios/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, email, role, novaSenha } = req.body;
    try {
        const dados = { nome, email, role };
        if (novaSenha && novaSenha.trim() !== '') {
            dados.senha = await bcrypt.hash(novaSenha, 10);
        }
        const usuario = await prisma.usuario.update({ where: { id }, data: dados });
        res.json(usuario);
    } catch (e) { res.status(500).json({ erro: "Erro ao atualizar" }); }
});

app.post('/usuarios/:id/reset-link', async (req, res) => {
    res.json({ mensagem: "Link de redefinição enviado (Simulação)" });
});

// ==========================================
// 4. ROTAS DE BANCOS (RESTAURADAS)
// ==========================================
app.get('/bancos', async (req, res) => {
    const { usuarioId } = req.query; if(!usuarioId) return res.json([]);
    try {
        const bancos = await prisma.banco.findMany({ where: { usuarioId }, include: { transacoes: { where: { OR: [ { status: 'PAGO' }, { status: 'RECEBIDO' } ] } } }, orderBy: { nome: 'asc' } });
        const comSaldo = bancos.map(b => {
            let saldo = parseFloat(b.saldoInicial);
            b.transacoes.forEach(t => { if (t.tipo === 'RECEITA') saldo += t.valor; else if (t.tipo === 'DESPESA') saldo -= t.valor; });
            return { ...b, saldoAtual: saldo, transacoes: undefined };
        });
        res.json(comSaldo);
    } catch(e) { res.status(500).json({ erro: "Erro bancos" }); }
});

app.post('/bancos', async (req, res) => {
    try {
        const { nome, agencia, conta, saldoInicial, dataSaldoInicial, inativo, usuarioId } = req.body;
        const b = await prisma.banco.create({
            data: { nome, agencia, conta, saldoInicial: parseFloat(saldoInicial||0), dataSaldoInicial: new Date(dataSaldoInicial), inativo: !!inativo, usuario: { connect: { id: usuarioId } } }
        });
        res.json(b);
    } catch(e) { res.status(500).json({ erro: "Erro criar banco" }); }
});

app.put('/bancos/:id', async (req, res) => {
    try {
        const { nome, agencia, conta, saldoInicial, dataSaldoInicial, inativo } = req.body;
        const b = await prisma.banco.update({
            where: { id: req.params.id },
            data: { nome, agencia, conta, saldoInicial: parseFloat(saldoInicial||0), dataSaldoInicial: new Date(dataSaldoInicial), inativo: !!inativo }
        });
        res.json(b);
    } catch(e) { res.status(500).json({ erro: "Erro atualizar banco" }); }
});

app.delete('/bancos/:id', async (req, res) => {
    try { await prisma.banco.delete({ where: { id: req.params.id } }); res.status(204).send(); } catch(e) { res.status(400).json({ erro: "Banco tem movimentos" }); }
});

// ==========================================
// 5. ROTAS DE EVENTOS (RESTAURADAS)
// ==========================================
app.get('/eventos', async (req, res) => {
    const { usuarioId } = req.query; if(!usuarioId) return res.json([]);
    const evs = await prisma.evento.findMany({ where: { usuarioId }, orderBy: { data: 'asc' } });
    res.json(evs);
});
app.post('/eventos', async (req, res) => {
    const { titulo, descricao, data, tipo, usuarioId } = req.body;
    try { const ev = await prisma.evento.create({ data: { titulo, descricao, data: new Date(data), tipo, usuario: { connect: { id: usuarioId } } } }); res.json(ev); } catch(e){ res.status(500).send(); }
});
app.delete('/eventos/:id', async (req, res) => {
    await prisma.evento.delete({ where: { id: req.params.id } }); res.status(204).send();
});
app.patch('/eventos/:id/toggle', async (req, res) => {
    const ev = await prisma.evento.update({ where: { id: req.params.id }, data: { concluido: req.body.concluido } }); res.json(ev);
});

// ==========================================
// 6. ROTAS DE DASHBOARD & RELATÓRIOS
// ==========================================
app.get('/dashboard/resumo', async (req, res) => {
    const { usuarioId } = req.query; if (!usuarioId) return res.json({ saldoTotal: 0 });
    const hoje = new Date(); const i = new Date(hoje.getFullYear(), hoje.getMonth(), 1); const f = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    const bancos = await prisma.banco.findMany({ where: { usuarioId } });
    const saldoIni = bancos.reduce((acc, b) => acc + parseFloat(b.saldoInicial), 0);
    const recGeral = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'RECEITA', status: 'RECEBIDO' } });
    const pagGeral = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'DESPESA', status: 'PAGO' } });
    const recMes = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'RECEITA', status: 'RECEBIDO', data: { gte: i, lte: f } } });
    const despMes = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'DESPESA', status: 'PAGO', data: { gte: i, lte: f } } });
    res.json({
        saldoTotal: saldoIni + (recGeral._sum.valor||0) - (pagGeral._sum.valor||0),
        receitaReal: recMes._sum.valor || 0, despesaReal: despMes._sum.valor || 0
    });
});

app.get('/relatorios/projecao-mensal', async (req, res) => {
    const { usuarioId, mes } = req.query;
    if(!usuarioId || !mes) return res.json({ receitas: 0, despesas: 0, saldo: 0 });
    const start = new Date(`${mes}-01T00:00:00.000Z`); const end = new Date(new Date(start).setMonth(start.getMonth()+1));
    const filtro = { gte: start, lt: end };
    const rec = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'RECEITA', status: 'PENDENTE', OR: [{data: filtro}, {dataVencimento: filtro}] } });
    const desp = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'DESPESA', status: 'PENDENTE', OR: [{data: filtro}, {dataVencimento: filtro}] } });
    const r = rec._sum.valor||0; const d = desp._sum.valor||0;
    res.json({ receitas: r, despesas: d, saldoPrevisto: r - d });
});

app.get('/relatorios/avancado', async (req, res) => {
    const { usuarioId, inicio, fim, bancoId } = req.query; if(!usuarioId) return res.json({});
    const i = new Date(inicio + "T00:00:00"); const f = new Date(fim + "T23:59:59");
    const where = { usuarioId, status: { in: ['PAGO', 'RECEBIDO'] }, tipo: 'DESPESA', dataPagamento: { gte: i, lte: f } };
    if(bancoId) where.bancoId = bancoId;
    
    const formas = await prisma.transacao.groupBy({ by: ['formaPagamento'], _sum: { valor: true }, where });
    const top5 = await prisma.transacao.groupBy({ by: ['fornecedor'], _sum: { valor: true }, where, orderBy: { _sum: { valor: 'desc' } }, take: 5 });
    const total = await prisma.transacao.aggregate({ _sum: { valor: true }, where });
    
    // Cartões
    const cartoes = await prisma.transacao.groupBy({ by: ['bancoId'], _sum: { valor: true }, where: { ...where, formaPagamento: { in: ['Cartão', 'Crédito'] } } });
    const listaCartoes = [];
    for(const c of cartoes) { if(c.bancoId) { const b = await prisma.banco.findUnique({where:{id:c.bancoId}}); listaCartoes.push({nome: b.nome, total: c._sum.valor}); } }

    res.json({ porForma: formas, porFornecedor: top5, totalGeral: total._sum.valor||0, cartao: { total: listaCartoes.reduce((a,b)=>a+b.total,0), lista: listaCartoes } });
});

// ==========================================
// 7. AUTH E LIMPEZA
// ==========================================
app.post('/auth/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const u = await prisma.usuario.findUnique({ where: { email } });
        if(!u || !(await bcrypt.compare(senha, u.senha))) return res.status(401).json({ erro: "Login inválido" });
        res.json({ id: u.id, nome: u.nome, email: u.email, role: u.role });
    } catch(e) { res.status(500).json({ erro: "Erro login" }); }
});

app.post('/auth/registrar', async (req, res) => {
    try {
        const { nome, email, senha } = req.body;
        const hash = await bcrypt.hash(senha, 10);
        const u = await prisma.usuario.create({ data: { nome, email, senha: hash, role: 'USER' } });
        res.json(u);
    } catch(e) { res.status(500).json({ erro: "Erro registro" }); }
});

app.get('/limpar-tudo', async (req, res) => {
    await prisma.transacao.deleteMany({});
    await prisma.banco.deleteMany({});
    await prisma.evento.deleteMany({});
    res.send("Sistema Zerado.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Servidor completo rodando na porta ${PORT}`); });