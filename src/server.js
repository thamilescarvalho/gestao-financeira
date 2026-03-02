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

function detectarFormaPagamento(texto) {
    if (!texto) return "Outros";
    const t = texto.toLowerCase();
    if (t.includes('cashback')) return "Cashback";
    if (t.includes('pix')) return "Pix";
    if (t.includes('boleto')) return "Boleto";
    if (t.includes('compra') || t.includes('pagamento') || t.includes('cartao') || t.includes('card') || t.includes('pan')) return "Cartão";
    return "Outros";
}

async function checarDuplicidade(usuarioId, transacoes) {
    if (!usuarioId) return transacoes;
    return await Promise.all(transacoes.map(async (t) => {
        const [ano, mes, dia] = t.data.split('-').map(Number);
        const dataInicio = new Date(Date.UTC(ano, mes - 1, dia, 0, 0, 0));
        const dataFim = new Date(Date.UTC(ano, mes - 1, dia, 23, 59, 59));
        const duplicata = await prisma.transacao.findFirst({
            where: {
                usuarioId: usuarioId,
                valor: { equals: t.valor }, 
                tipo: t.tipo,   
                data: { gte: dataInicio, lte: dataFim }
            }
        });
        if (duplicata) {
            const d = new Date(duplicata.data);
            const diaFmt = d.getUTCDate().toString().padStart(2, '0');
            const mesFmt = (d.getUTCMonth() + 1).toString().padStart(2, '0');
            const nomeEncontrado = duplicata.fornecedor || duplicata.descricao;
            const statusStr = duplicata.status === 'PENDENTE' ? 'Aberto' : 'Pago';
            return { ...t, duplicata: true, duplicataInfo: `Já existe: ${nomeEncontrado} (R$ ${duplicata.valor} em ${diaFmt}/${mesFmt} - ${statusStr})` };
        }
        return { ...t, duplicata: false };
    }));
}

// --- ROTA TRANSFERÊNCIA ---
app.post('/transacoes/transferencia', async (req, res) => {
    const { bancoOrigemId, bancoDestinoId, valor, data, descricao, usuarioId } = req.body;
    if (!bancoOrigemId || !bancoDestinoId || !valor || !usuarioId) return res.status(400).json({ erro: "Dados incompletos." });
    if (bancoOrigemId === bancoDestinoId) return res.status(400).json({ erro: "Origem e destino devem ser diferentes." });
    try {
        const dt = new Date(data ? `${data}T12:00:00` : new Date());
        const val = parseFloat(valor);
        await prisma.$transaction([
            prisma.transacao.create({ data: { tipo: 'DESPESA', status: 'PAGO', valor: val, descricao: `Transf. para: Destino (Saída)`, fornecedor: 'Transferência Interna', formaPagamento: 'Transferência', data: dt, dataPagamento: dt, dataVencimento: dt, banco: { connect: { id: bancoOrigemId } }, usuario: { connect: { id: usuarioId } }, categoria: 'Transferência' } }),
            prisma.transacao.create({ data: { tipo: 'RECEITA', status: 'RECEBIDO', valor: val, descricao: `Transf. de: Origem (Entrada)`, fornecedor: 'Transferência Interna', formaPagamento: 'Transferência', data: dt, dataPagamento: dt, dataVencimento: dt, banco: { connect: { id: bancoDestinoId } }, usuario: { connect: { id: usuarioId } }, categoria: 'Transferência' } })
        ]);
        res.json({ mensagem: "Transferência realizada com sucesso!" });
    } catch (e) { res.status(500).json({ erro: "Erro ao processar transferência." }); }
});

// --- ROTA POST TRANSACOES ---
app.post('/transacoes', async (req, res) => {
    try {
        const { descricao, valor, tipo, categoria, status, data, dataPagamento, bancoId, usuarioId, fornecedor, formaPagamento, parcelas, itensParcelados, parcelaInfo, cartaoId } = req.body;
        
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
                        parcelaInfo: item.parcelaInfo || "1/1",
                        parcelas: parseInt(parcelas) || 1,
                        banco: (bancoId) ? { connect: { id: bancoId } } : undefined,
                        usuario: { connect: { id: usuarioId } },
                        cartao: (cartaoId) ? { connect: { id: cartaoId } } : undefined 
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
                    parcelaInfo: parcelaInfo || "1/1", 
                    banco: (bancoId) ? { connect: { id: bancoId } } : undefined,
                    usuario: { connect: { id: usuarioId } },
                    cartao: (cartaoId) ? { connect: { id: cartaoId } } : undefined
                }
            }));
        }
        res.json(criadas[0]);
    } catch (e) { console.error(e); res.status(500).json({ erro: "Erro ao salvar: " + e.message }); }
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

// --- ROTA PUT TRANSACOES ---
app.put('/transacoes/:id', async (req, res) => {
    const { id } = req.params;
    const body = req.body;
    
    try {
        let dados = {};
        
        if (body.status === 'PENDENTE' && body.fornecedor === undefined && body.valor === undefined) {
            const tr = await prisma.transacao.findUnique({ where: { id } });
            dados = { 
                status: 'PENDENTE', 
                dataPagamento: null, 
                valor: tr.valorOriginal || tr.valor, 
                valorOriginal: null 
            };
            if (tr.bancoId) dados.banco = { disconnect: true };
        } 
        else {
            const { itensParcelados, usuarioId, id: _id, cartaoId, ...resto } = body; 
            dados = { ...resto };
            
            if (body.dataVencimento) {
                const dt = new Date(body.dataVencimento.includes('T') ? body.dataVencimento : `${body.dataVencimento}T12:00:00`);
                dados.dataVencimento = dt;
                dados.data = dt; 
            }
            
            if (body.valor) {
                dados.valor = parseFloat(body.valor);
            }
            
            if (cartaoId !== undefined) {
                if (cartaoId) {
                    dados.cartao = { connect: { id: cartaoId } };
                } else {
                    dados.cartao = { disconnect: true };
                }
            }
        }
        
        const atualizado = await prisma.transacao.update({ 
            where: { id }, 
            data: dados 
        });
        
        res.json(atualizado);
    } catch (e) { 
        console.error("Erro PUT /transacoes/:id :", e);
        res.status(500).json({ erro: "Erro ao atualizar a transação." }); 
    }
});

app.delete('/transacoes/:id', async (req, res) => { try { await prisma.transacao.delete({ where: { id: req.params.id } }); res.status(204).send(); } catch(e) { res.status(500).send(); } });

// --- ROTA DE BAIXA DE TRANSAÇÃO (CARTÃO) ---
app.put('/transacoes/:id/baixar', async (req, res) => {
    const { id } = req.params;
    const { bancoId, dataPagamento, valorPago, juros, descricao, formaPagamento} = req.body;

    try {
        const tr = await prisma.transacao.findUnique({ where: { id } });
        if (!tr) return res.status(404).json({ erro: "Transação não encontrada" });

        const status = tr.tipo === 'DESPESA' ? 'PAGO' : 'RECEBIDO';
        const dt = new Date(dataPagamento.includes('T') ? dataPagamento : `${dataPagamento}T12:00:00`);
        
        let valorJuros = juros ? parseFloat(juros) : 0;
        if (!juros && parseFloat(valorPago) > tr.valor) {
             valorJuros = parseFloat(valorPago) - tr.valor;
        }

        let dadosAtualizacao = {
            status,
            dataPagamento: dt,
            valor: parseFloat(valorPago),
            valorOriginal: tr.valorOriginal || tr.valor,
            juros: valorJuros
        };
        if (descricao !== undefined) {
            dadosAtualizacao.descricao = descricao;
        }

        if (tr.formaPagamento === 'Cartão' || tr.cartaoId) {
        } else {
            dadosAtualizacao.bancoId = bancoId;
        }

        const up = await prisma.transacao.update({
            where: { id },
            data: dadosAtualizacao
        });

        res.json(up);
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "Erro na baixa" });
    }
});

// ROTA PARA ESTORNAR/ALTERAR STATUS DA TRANSAÇÃO
app.patch('/transacoes/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const transacaoAtualizada = await prisma.transacao.update({
            where: { id: String(id) },
            data: { status }
        });

        res.status(200).json(transacaoAtualizada);
    } catch (error) {
        console.error("Erro ao atualizar status da transação:", error);
        res.status(500).json({ erro: "Erro ao estornar a transação." });
    }
});

app.post('/importar/ler-csv', async (req, res) => { try { const { conteudo, usuarioId } = req.body; if (!conteudo) return res.status(400).json({ erro: "Vazio" }); const linhas = conteudo.split(/\r?\n/); const lista = []; for (let i = 1; i < linhas.length; i++) { const cols = linhas[i].split(';'); if (cols.length < 5) continue; const fornecedor = cols[0]; const dataRaw = cols[1]; const total = parseInt(cols[3]) || 1; const atual = parseInt(cols[4]) || 1; const valor = parseFloat(cols[5].replace('R$', '').replace(/\./g, '').replace(',', '.').trim()); if(!fornecedor || !dataRaw) continue; const [d, m, y] = dataRaw.split('/'); const dataBase = new Date(y, m-1, d, 12, 0, 0); const formaDetectada = detectarFormaPagamento(fornecedor); for (let p = atual; p <= total; p++) { const dt = new Date(dataBase); dt.setMonth(dataBase.getMonth() + (p - atual)); const dataIso = dt.toISOString().split('T')[0]; let desc = fornecedor; let info = "1/1"; if(total > 1) { desc = `${fornecedor} (${p}/${total})`; info = `${p}/${total}`; } lista.push({ data: dataIso, descricao: desc, fornecedor, valor, tipo: 'DESPESA', parcelas: total, parcelaInfo: info, formaPagamento: formaDetectada, id_transacao: `csv-${i}-${p}` }); } } const verificados = await checarDuplicidade(usuarioId, lista); res.json(verificados); } catch (e) { res.status(500).json({ erro: "Erro CSV" }); } });
app.post('/conciliacao/ler-ofx', upload.single('arquivo'), async (req, res) => { try { if (!req.file) return res.status(400).json({ erro: "Nenhum arquivo enviado." }); const usuarioId = req.body.usuarioId; const fileContent = req.file.buffer.toString('utf8'); let transacoesLimpas = []; if (fileContent.trim().startsWith('{')) { try { const json = JSON.parse(fileContent); if (json.data && Array.isArray(json.data)) { transacoesLimpas = json.data.map(t => { let forma = "Outros"; const tipoBanco = (t.type || "").toLowerCase(); if (tipoBanco.includes('pix')) forma = "Pix"; else if (tipoBanco.includes('cartão') || tipoBanco.includes('credit')) forma = "Cartão"; else if (tipoBanco.includes('boleto')) forma = "Boleto"; if (forma === "Outros") forma = detectarFormaPagamento(t.title); return { data: t.dateTime.split('T')[0], descricao: t.title, valor: Math.abs(t.rawAmount/100), tipo: t.direction === 'in' ? 'RECEITA' : 'DESPESA', formaPagamento: forma }; }); } } catch(e) {} } else { const data = ofx.parse(fileContent); let listaBruta = data.OFX?.BANKMSGSRSV1?.STMTTRNRS?.STMTRS?.BANKTRANLIST?.STMTTRN || data.OFX?.CREDITCARDMSGSRSV1?.CCSTMTTRNRS?.CCSTMTRS?.BANKTRANLIST?.STMTTRN; if (listaBruta) { const arr = Array.isArray(listaBruta) ? listaBruta : [listaBruta]; transacoesLimpas = arr.map(t => { const rawDate = (t.DTPOSTED || "").substring(0, 8); const dt = rawDate.length === 8 ? `${rawDate.substring(0, 4)}-${rawDate.substring(4, 6)}-${rawDate.substring(6, 8)}` : new Date().toISOString().split('T')[0]; const val = parseFloat(String(t.TRNAMT).replace(',', '.')); const nome = t.MEMO || "Sem descrição"; const tipoOfx = (t.TRNTYPE || "").toLowerCase(); let forma = "Outros"; if (tipoOfx === 'debit' || tipoOfx === 'pos') forma = "Cartão"; else forma = detectarFormaPagamento(nome); return { data: dt, descricao: nome, valor: Math.abs(val), tipo: val < 0 ? 'DESPESA' : 'RECEITA', formaPagamento: forma }; }); } } if (transacoesLimpas.length === 0) return res.status(400).json({ erro: "Formato desconhecido." }); const transacoesVerificadas = await checarDuplicidade(usuarioId, transacoesLimpas); let totalEntradas = 0, totalSaidas = 0; transacoesVerificadas.forEach(t => { if (t.tipo === 'RECEITA') totalEntradas += t.valor; else totalSaidas += t.valor; }); const resumo = { totalEntradas, totalSaidas, saldoPeriodo: totalEntradas - totalSaidas, totalItens: transacoesVerificadas.length }; res.json({ transacoes: transacoesVerificadas, resumo }); } catch (e) { console.error(e); res.status(500).json({ erro: "Erro ao ler arquivo." }); } });

app.get('/usuarios', async (req, res) => { 
    try { 
        const u = await prisma.usuario.findMany({ 
            select: { 
                id: true, 
                nome: true, 
                email: true, 
                role: true, 
                ultimoAcesso: true
            }, 
            orderBy: { nome: 'asc' } 
        }); 
        res.json(u); 
    } catch (e) { 
        res.status(500).json({ erro: "Erro usuarios" }); 
    } 
});

app.patch('/usuarios/:id/role', async (req, res) => { try { const u = await prisma.usuario.update({ where: { id: req.params.id }, data: { role: req.body.role } }); res.json(u); } catch (e) { res.status(500).json({ erro: "Erro role" }); } });
app.delete('/usuarios/:id', async (req, res) => { try { await prisma.usuario.delete({ where: { id: req.params.id } }); res.status(204).send(); } catch (e) { res.status(500).json({ erro: "Erro excluir" }); } });

app.put('/usuarios/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, email, role, novaSenha, avatar, capa, bio } = req.body; 
    
    try {
        const d = { nome, email, role };
        if (novaSenha) d.senha = await bcrypt.hash(novaSenha, 10);
        
        if (avatar !== undefined) d.avatar = avatar;
        if (capa !== undefined) d.capa = capa;
        if (bio !== undefined) d.bio = bio;

        const u = await prisma.usuario.update({ where: { id }, data: d });
        
        const userSemSenha = { ...u };
        delete userSemSenha.senha;
        res.json(userSemSenha);
    } catch (e) { 
        console.error(e); 
        res.status(500).json({ erro: "Erro atualizar" }); 
    }
});

app.post('/usuarios/:id/reset-link', async (req, res) => { res.json({ mensagem: "Link enviado" }); });
app.get('/bancos', async (req, res) => { const { usuarioId } = req.query; if(!usuarioId) return res.json([]); try { const bancos = await prisma.banco.findMany({ where: { usuarioId }, include: { transacoes: { where: { OR: [ { status: 'PAGO' }, { status: 'RECEBIDO' } ] } } }, orderBy: { nome: 'asc' } }); const comSaldo = bancos.map(b => { let saldo = parseFloat(b.saldoInicial); b.transacoes.forEach(t => { if (t.tipo === 'RECEITA') saldo += t.valor; else if (t.tipo === 'DESPESA') saldo -= t.valor; }); return { ...b, saldoAtual: saldo, transacoes: undefined }; }); res.json(comSaldo); } catch(e) { res.status(500).json({ erro: "Erro bancos" }); } });
app.post('/bancos', async (req, res) => { try { const { nome, agencia, conta, saldoInicial, dataSaldoInicial, inativo, usuarioId } = req.body; const b = await prisma.banco.create({ data: { nome, agencia, conta, saldoInicial: parseFloat(saldoInicial||0), dataSaldoInicial: new Date(dataSaldoInicial), inativo: !!inativo, usuario: { connect: { id: usuarioId } } } }); res.json(b); } catch(e) { res.status(500).json({ erro: "Erro criar banco" }); } });
app.put('/bancos/:id', async (req, res) => { try { const { nome, agencia, conta, saldoInicial, dataSaldoInicial, inativo } = req.body; const b = await prisma.banco.update({ where: { id: req.params.id }, data: { nome, agencia, conta, saldoInicial: parseFloat(saldoInicial||0), dataSaldoInicial: new Date(dataSaldoInicial), inativo: !!inativo } }); res.json(b); } catch(e) { res.status(500).json({ erro: "Erro atualizar banco" }); } });
app.delete('/bancos/:id', async (req, res) => { try { await prisma.banco.delete({ where: { id: req.params.id } }); res.status(204).send(); } catch(e) { res.status(400).json({ erro: "Banco com movimento" }); } });

// ROTAS DE EVENTOS / AGENDA
app.get('/eventos/alertas', async (req, res) => {
    const { usuarioId } = req.query;
    if (!usuarioId) return res.json([]);
    const hoje = new Date();
    const dataLimite = new Date();
    dataLimite.setDate(hoje.getDate() + 5); 
    try {
        const eventos = await prisma.evento.findMany({ where: { usuarioId: usuarioId, lembrete: true, concluido: false } });
        const proximos = eventos.filter(ev => {
            const dataEvento = new Date(ev.data);
            const aniversarioEsseAno = new Date(hoje.getFullYear(), dataEvento.getMonth(), dataEvento.getDate());
            return aniversarioEsseAno >= hoje && aniversarioEsseAno <= dataLimite;
        });
        res.json(proximos);
    } catch (e) { console.error(e); res.status(500).json([]); }
});

app.get('/eventos', async (req, res) => { const { usuarioId } = req.query; if(!usuarioId) return res.json([]); const evs = await prisma.evento.findMany({ where: { usuarioId }, orderBy: { data: 'asc' } }); res.json(evs); });
app.post('/eventos', async (req, res) => { const { titulo, descricao, local, data, tipo, lembrete, usuarioId } = req.body; try { const ev = await prisma.evento.create({ data: { titulo, descricao, local, data: new Date(data), tipo: tipo || 'TAREFA', lembrete: lembrete || false, usuario: { connect: { id: usuarioId } } } }); res.json(ev); } catch(e){ res.status(500).send(); } });
app.put('/eventos/:id', async (req, res) => { const { titulo, descricao, local, data, tipo, lembrete } = req.body; try { const ev = await prisma.evento.update({ where: { id: req.params.id }, data: { titulo, descricao, local, data: new Date(data), tipo, lembrete: lembrete } }); res.json(ev); } catch(e) { res.status(500).send(); } });
app.delete('/eventos/:id', async (req, res) => { await prisma.evento.delete({ where: { id: req.params.id } }); res.status(204).send(); });
app.patch('/eventos/:id/toggle', async (req, res) => { const ev = await prisma.evento.update({ where: { id: req.params.id }, data: { concluido: req.body.concluido } }); res.json(ev); });

app.get('/dashboard/resumo', async (req, res) => { const { usuarioId } = req.query; if (!usuarioId) return res.json({ saldoTotal: 0 }); const hoje = new Date(); const i = new Date(hoje.getFullYear(), hoje.getMonth(), 1); const f = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0); const bancos = await prisma.banco.findMany({ where: { usuarioId } }); const saldoIni = bancos.reduce((acc, b) => acc + parseFloat(b.saldoInicial), 0); const recGeral = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'RECEITA', status: 'RECEBIDO' } }); const pagGeral = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'DESPESA', status: 'PAGO' } }); const recMes = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'RECEITA', status: 'RECEBIDO', data: { gte: i, lte: f } } }); const despMes = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'DESPESA', status: 'PAGO', data: { gte: i, lte: f } } }); res.json({ saldoTotal: saldoIni + (recGeral._sum.valor||0) - (pagGeral._sum.valor||0), receitaReal: recMes._sum.valor || 0, despesaReal: despMes._sum.valor || 0 }); });
app.get('/relatorios/projecao-mensal', async (req, res) => { const { usuarioId, mes } = req.query; if(!usuarioId || !mes) return res.json({ receitas: 0, despesas: 0, saldo: 0 }); const start = new Date(`${mes}-01T00:00:00.000Z`); const end = new Date(new Date(start).setMonth(start.getMonth()+1)); const filtro = { gte: start, lt: end }; const rec = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'RECEITA', status: 'PENDENTE', OR: [{data: filtro}, {dataVencimento: filtro}] } }); const desp = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'DESPESA', status: 'PENDENTE', OR: [{data: filtro}, {dataVencimento: filtro}] } }); res.json({ receitas: rec._sum.valor||0, despesas: desp._sum.valor||0, saldoPrevisto: (rec._sum.valor||0) - (desp._sum.valor||0) }); });
app.get('/relatorios/avancado', async (req, res) => { const { usuarioId, inicio, fim, bancoId } = req.query; if(!usuarioId) return res.json({}); const i = new Date(inicio + "T00:00:00"); const f = new Date(fim + "T23:59:59"); const where = { usuarioId, status: { in: ['PAGO', 'RECEBIDO'] }, tipo: 'DESPESA', dataPagamento: { gte: i, lte: f } }; if(bancoId) where.bancoId = bancoId; const formas = await prisma.transacao.groupBy({ by: ['formaPagamento'], _sum: { valor: true }, where }); const top5 = await prisma.transacao.groupBy({ by: ['fornecedor'], _sum: { valor: true }, where, orderBy: { _sum: { valor: 'desc' } }, take: 5 }); const total = await prisma.transacao.aggregate({ _sum: { valor: true }, where }); const cartoes = await prisma.transacao.groupBy({ by: ['bancoId'], _sum: { valor: true }, where: { ...where, formaPagamento: { in: ['Cartão', 'Crédito'] } } }); const listaCartoes = []; for(const c of cartoes) { if(c.bancoId) { const b = await prisma.banco.findUnique({where:{id:c.bancoId}}); listaCartoes.push({nome: b.nome, total: c._sum.valor}); } } res.json({ porForma: formas, porFornecedor: top5, totalGeral: total._sum.valor||0, cartao: { total: listaCartoes.reduce((a,b)=>a+b.total,0), lista: listaCartoes } }); });

// --- ROTA DE LOGIN (ATUALIZADA COM ULTIMO ACESSO) ---
app.post('/auth/login', async (req, res) => { 
    const { email, senha } = req.body; 
    try { 
        const u = await prisma.usuario.findUnique({ where: { email } }); 
        if(!u || !(await bcrypt.compare(senha, u.senha))) return res.status(401).json({ erro: "Login inválido" }); 
        
        // ATUALIZA ULTIMO ACESSO
        await prisma.usuario.update({
            where: { id: u.id },
            data: { ultimoAcesso: new Date() }
        });

        res.json({ 
            id: u.id, 
            nome: u.nome, 
            email: u.email, 
            role: u.role,
            avatar: u.avatar,
            capa: u.capa,
            bio: u.bio,
            ultimoAcesso: new Date()
        }); 
    } catch(e) { res.status(500).json({ erro: "Erro login" }); } 
});

// --- ROTAS DE CARTÕES DE CRÉDITO ---

// Listar Cartões
app.get('/cartoes', async (req, res) => {
    const { usuarioId } = req.query;
    if(!usuarioId) return res.json([]);
    try {
        const cartoes = await prisma.cartao.findMany({ 
            where: { usuarioId },
            orderBy: { nome: 'asc' }
        });
        res.json(cartoes);
    } catch(e) { res.status(500).json({erro: "Erro ao buscar cartões"}); }
});

// Criar Cartão
app.post('/cartoes', async (req, res) => {
    const { nome, limite, fechamento, vencimento, usuarioId } = req.body;
    try {
        const novo = await prisma.cartao.create({
            data: {
                nome,
                limite: parseFloat(limite),
                fechamento: parseInt(fechamento),
                vencimento: parseInt(vencimento),
                usuario: { connect: { id: usuarioId } }
            }
        });
        res.json(novo);
    } catch(e) { res.status(500).json({erro: "Erro ao criar cartão"}); }
});

// Atualizar Cartão
app.put('/cartoes/:id', async (req, res) => {
    const { nome, limite, fechamento, vencimento } = req.body;
    try {
        const at = await prisma.cartao.update({
            where: { id: req.params.id },
            data: {
                nome,
                limite: parseFloat(limite),
                fechamento: parseInt(fechamento),
                vencimento: parseInt(vencimento)
            }
        });
        res.json(at);
    } catch(e) { res.status(500).json({erro: "Erro ao atualizar"}); }
});

// Excluir Cartão
app.delete('/cartoes/:id', async (req, res) => {
    try {
        await prisma.transacao.updateMany({
            where: { cartaoId: req.params.id },
            data: { cartaoId: null }
        });
        
        await prisma.cartao.delete({ where: { id: req.params.id } });
        res.status(204).send();
    } catch(e) { res.status(500).json({erro: "Erro ao excluir"}); }
});

// --- INTELIGÊNCIA DA FATURA ---
app.get('/cartoes/:id/fatura', async (req, res) => {
    const { id } = req.params;
    const { mes, ano, diaFechamento } = req.query; 

    try {
        const m = parseInt(mes);
        const a = parseInt(ano);
        const diaFecha = parseInt(diaFechamento);
        
        const dataFimCiclo = new Date(a, m - 1, diaFecha, 23, 59, 59);
        const dataInicioCiclo = new Date(a, m - 2, diaFecha + 1, 0, 0, 0);

        const itens = await prisma.transacao.findMany({
            where: {
                cartaoId: id,
                data: {
                    gte: dataInicioCiclo,
                    lte: dataFimCiclo
                },
                tipo: 'DESPESA' 
            },
            orderBy: { data: 'desc' }
        });

        const total = itens.reduce((acc, t) => acc + parseFloat(t.valor), 0);
        
        const pendentes = itens.filter(t => t.status === 'PENDENTE');
        const statusFatura = (itens.length > 0 && pendentes.length === 0) ? 'PAGA' : 'ABERTA';

        res.json({
            itens,
            total,
            status: statusFatura,
            periodo: `${dataInicioCiclo.toLocaleDateString('pt-BR')} a ${dataFimCiclo.toLocaleDateString('pt-BR')}`
        });

    } catch(e) { 
        console.error(e);
        res.status(500).json({erro: "Erro ao calcular fatura"}); 
    }
});

// --- PAGAR FATURA ---
app.post('/cartoes/:id/pagar-fatura', async (req, res) => {
    const { idsTransacoes, valorTotal, bancoPagamentoId, dataPagamento, nomeCartao, usuarioId } = req.body;

    try {
        const dt = new Date(dataPagamento + "T12:00:00");

        await prisma.$transaction([
            prisma.transacao.updateMany({
                where: { id: { in: idsTransacoes } },
                data: { status: 'FATURADO' } 
            }),

            prisma.transacao.create({
                data: {
                    descricao: `Pagamento Fatura - ${nomeCartao}`,
                    fornecedor: nomeCartao,
                    valor: parseFloat(valorTotal),
                    tipo: 'DESPESA',
                    categoria: 'Pagamento de Fatura',
                    status: 'PAGO',
                    formaPagamento: 'Boleto',
                    data: dt, dataPagamento: dt, dataVencimento: dt,
                    banco: { connect: { id: bancoPagamentoId } },
                    usuario: { connect: { id: usuarioId } },
                    parcelas: 1, parcelaInfo: '1/1'
                }
            })
        ]);

        res.json({ ok: true });
    } catch(e) {
        console.error(e);
        res.status(500).json({erro: "Erro ao pagar fatura"});
    }
});

// --- ROTAS DE PROJETOS ---
app.get('/projetos', async (req, res) => {
    const { usuarioId } = req.query;
    if(!usuarioId) return res.json([]);
    try {
        const projetos = await prisma.projeto.findMany({
            where: { usuarioId },
            include: { subtarefas: { orderBy: { id: 'asc' } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json(projetos);
    } catch(e) { res.status(500).json([]); }
});

app.post('/projetos', async (req, res) => {
    const { nome, icone, status, prazo, usuarioId } = req.body;
    try {
        const novo = await prisma.projeto.create({
            data: {
                nome, icone, status,
                prazo: prazo ? new Date(prazo) : null,
                usuario: { connect: { id: usuarioId } }
            }
        });
        res.json(novo);
    } catch(e) { res.status(500).send(); }
});

app.put('/projetos/:id', async (req, res) => {
    const { nome, icone, status, prazo, isFavorite } = req.body;
    try {
        const dados = {};
        if(nome) dados.nome = nome;
        if(icone) dados.icone = icone;
        if(status) dados.status = status;
        if(prazo !== undefined) dados.prazo = prazo ? new Date(prazo) : null;
        if(isFavorite !== undefined) dados.isFavorite = isFavorite;

        const at = await prisma.projeto.update({
            where: { id: req.params.id },
            data: dados
        });
        res.json(at);
    } catch(e) { res.status(500).send(); }
});

app.delete('/projetos/:id', async (req, res) => {
    try {
        await prisma.projeto.delete({ where: { id: req.params.id } });
        res.status(204).send();
    } catch(e) { res.status(500).send(); }
});

// --- ROTAS DE SUBTAREFAS ---
app.post('/subtarefas', async (req, res) => {
    const { nome, projetoId } = req.body;
    try {
        const sub = await prisma.subtarefa.create({
            data: { nome, projeto: { connect: { id: projetoId } } }
        });
        res.json(sub);
    } catch(e) { res.status(500).send(); }
});

app.put('/subtarefas/:id', async (req, res) => {
    const { nome, concluido } = req.body;
    try {
        const sub = await prisma.subtarefa.update({
            where: { id: req.params.id },
            data: { 
                nome: nome !== undefined ? nome : undefined,
                concluido: concluido !== undefined ? concluido : undefined
            }
        });
        res.json(sub);
    } catch(e) { res.status(500).send(); }
});

app.delete('/subtarefas/:id', async (req, res) => {
    try {
        await prisma.subtarefa.delete({ where: { id: req.params.id } });
        res.status(204).send();
    } catch(e) { res.status(500).send(); }
});

// --- ROTAS DE COFRINHOS (METAS) ---

// Listar Cofrinhos
app.get('/cofrinhos', async (req, res) => {
    const { usuarioId } = req.query;
    try {
        const metas = await prisma.cofrinho.findMany({ where: { usuarioId }, orderBy: { saldo: 'desc' } });
        res.json(metas);
    } catch(e) { res.status(500).json([]); }
});

// Criar Novo Cofrinho
app.post('/cofrinhos', async (req, res) => {
    const { nome, meta, icone, cor, usuarioId } = req.body;
    try {
        const novo = await prisma.cofrinho.create({
            data: { nome, meta: parseFloat(meta), icone, cor, usuario: { connect: { id: usuarioId } } }
        });
        res.json(novo);
    } catch(e) { 
        console.error(e); 
        res.status(500).json({erro: "Erro ao criar"}); 
    }
});

// GUARDAR DINHEIRO (Tira do Banco -> Põe no Cofrinho)
app.post('/cofrinhos/:id/depositar', async (req, res) => {
    const { id } = req.params; 
    const { bancoId, valor, usuarioId } = req.body;
    const val = parseFloat(valor);

    try {
        const cofre = await prisma.cofrinho.findUnique({ where: { id } });
        if(!cofre) return res.status(404).json({erro: "Cofrinho não encontrado"});

        await prisma.$transaction([
            prisma.cofrinho.update({
                where: { id },
                data: { saldo: { increment: val } }
            }),
            prisma.transacao.create({
                data: {
                    descricao: `GUARDADO NO COFRINHO: ${cofre.nome.toUpperCase()}`,
                    fornecedor: 'COFRINHO',
                    valor: val,
                    tipo: 'DESPESA',
                    categoria: 'COFRINHO', // Usado para filtro no extrato
                    status: 'PAGO',
                    formaPagamento: 'Transferência',
                    data: new Date(), dataPagamento: new Date(), dataVencimento: new Date(),
                    banco: { connect: { id: bancoId } },
                    usuario: { connect: { id: usuarioId } },
                    parcelas: 1, parcelaInfo: '1/1'
                }
            })
        ]);
        res.json({ ok: true });
    } catch(e) { console.error(e); res.status(500).json({erro: "Erro ao depositar"}); }
});

// --- RESGATAR DINHEIRO COM RENDIMENTOS ---
app.post('/cofrinhos/:id/resgatar', async (req, res) => {
    try {
        const { id } = req.params;
        const { bancoId, valor, rendimento, usuarioId } = req.body;

        const cofre = await prisma.cofrinho.findUnique({ where: { id: String(id) } });
        if (!cofre) return res.status(404).json({ erro: 'Cofrinho não encontrado' });

        const valorPrincipal = parseFloat(valor) || 0;
        const valorRendimento = parseFloat(rendimento) || 0;

        if (valorPrincipal > 0 && cofre.saldo < valorPrincipal) {
            return res.status(400).json({ erro: 'Saldo insuficiente no cofrinho.' });
        }

        const transacoesParaCriar = [];

        if (valorPrincipal > 0) {
            transacoesParaCriar.push(
                prisma.cofrinho.update({
                    where: { id: String(id) },
                    data: { saldo: cofre.saldo - valorPrincipal }
                })
            );

            transacoesParaCriar.push(
                prisma.transacao.create({
                    data: {
                        descricao: `RESGATE DO COFRINHO: ${cofre.nome.toUpperCase()}`,
                        fornecedor: 'COFRINHO',
                        valor: valorPrincipal,
                        tipo: 'RECEITA',
                        status: 'RECEBIDO', 
                        formaPagamento: 'TRANSFERÊNCIA',
                        data: new Date(), dataPagamento: new Date(),
                        bancoId: String(bancoId),
                        usuarioId: String(usuarioId),
                        categoria: 'COFRINHO'
                    }
                })
            );
        }

        if (valorRendimento > 0) {
            transacoesParaCriar.push(
                prisma.transacao.create({
                    data: {
                        descricao: `RENDIMENTO DO COFRINHO: ${cofre.nome.toUpperCase()}`,
                        fornecedor: 'RENDIMENTO',
                        valor: valorRendimento,
                        tipo: 'RECEITA',
                        status: 'RECEBIDO',
                        formaPagamento: 'TRANSFERÊNCIA',
                        data: new Date(), dataPagamento: new Date(),
                        bancoId: String(bancoId),
                        usuarioId: String(usuarioId),
                        categoria: 'RENDIMENTO'
                    }
                })
            );
        }

        await prisma.$transaction(transacoesParaCriar);
        res.status(200).json({ mensagem: 'Resgate realizado com sucesso!' });
    } catch (error) {
        console.error("Erro ao resgatar:", error);
        res.status(500).json({ erro: 'Erro interno ao realizar resgate.' });
    }
});

// --- ROTA DE DESFAZER MOVIMENTAÇÃO ---
app.delete('/cofrinhos/:id/movimento/:transacaoId', async (req, res) => {
    const { id, transacaoId } = req.params;
    try {
        const tr = await prisma.transacao.findUnique({ where: { id: transacaoId } });
        const cofre = await prisma.cofrinho.findUnique({ where: { id } });
        
        if(tr && cofre) {
            const desc = tr.descricao.toUpperCase();
            
            // Se foi Guardar (Saiu do banco, entrou no cofre) -> Tem que devolver do Cofre
            if(tr.tipo === 'DESPESA' && desc.includes('GUARDADO')) {
                await prisma.cofrinho.update({ where: { id }, data: { saldo: cofre.saldo - tr.valor } });
            }
            // Se foi Resgatar Principal (Entrou no banco, saiu do cofre) -> Tem que devolver pro Cofre
            else if(tr.tipo === 'RECEITA' && desc.includes('RESGATE')) {
                await prisma.cofrinho.update({ where: { id }, data: { saldo: cofre.saldo + tr.valor } });
            }
            // Se for rendimento, é só apagar do banco, não mexe no cofre.
            
            // Apaga a transação
            await prisma.transacao.delete({ where: { id: transacaoId } });
        }
        res.status(204).send();
    } catch(e) {
        console.error(e);
        res.status(500).json({erro: "Erro ao desfazer"});
    }
});

app.put('/cofrinhos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, meta, icone, cor } = req.body;

        const cofrinhoAtualizado = await prisma.cofrinho.update({
            where: { id: String(id) },
            data: {
                nome,
                meta: parseFloat(meta),
                icone,
                cor
            }
        });

        res.status(200).json(cofrinhoAtualizado);
    } catch (error) {
        console.error("Erro ao atualizar cofrinho:", error);
        res.status(500).json({ erro: "Erro ao atualizar o cofrinho." });
    }
});

app.delete('/cofrinhos/:id', async (req, res) => {
    try { await prisma.cofrinho.delete({ where: { id: req.params.id } }); res.status(204).send(); } 
    catch(e) { res.status(500).send(); } 
});

app.post('/auth/registrar', async (req, res) => { try { const { nome, email, senha } = req.body; const hash = await bcrypt.hash(senha, 10); const u = await prisma.usuario.create({ data: { nome, email, senha: hash, role: 'USER' } }); res.json(u); } catch(e) { res.status(500).json({ erro: "Erro registro" }); } });
app.get('/limpar-tudo', async (req, res) => { await prisma.transacao.deleteMany({}); await prisma.banco.deleteMany({}); await prisma.evento.deleteMany({}); res.send("Sistema Zerado."); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Servidor completo rodando na porta ${PORT}`); });