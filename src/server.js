import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import ofx from 'node-ofx-parser';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Configuração de Upload (Memória RAM)
const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// 1. ROTA UNIFICADA DE CRIAR TRANSAÇÃO
// ==========================================
app.post('/transacoes', async (req, res) => {
    try {
        // ADICIONADO: formaPagamento
        const { descricao, valor, tipo, categoria, status, data, dataPagamento, bancoId, usuarioId, fornecedor, formaPagamento } = req.body;

        if (!usuarioId) return res.status(400).json({ erro: "ID do usuário é obrigatório." });

        let dataFinal = new Date();
        if (data) {
            const dataString = data.includes('T') ? data : `${data}T12:00:00`;
            dataFinal = new Date(dataString);
        }
        if (isNaN(dataFinal.getTime())) dataFinal = new Date();

        let dataPagtoFinal = null;
        if (dataPagamento) {
            const dataPagtoString = dataPagamento.includes('T') ? dataPagamento : `${dataPagamento}T12:00:00`;
            const testeData = new Date(dataPagtoString);
            if (!isNaN(testeData.getTime())) dataPagtoFinal = testeData;
        }

        const transacao = await prisma.transacao.create({
            data: {
                fornecedor: fornecedor || descricao, 
                descricao: descricao || "Sem descrição",
                // ADICIONADO: Salva a forma de pagamento
                formaPagamento: formaPagamento || "Outros", 
                valor: parseFloat(valor),
                tipo,
                categoria: categoria || 'Geral',
                status: status || 'PENDENTE',
                data: dataFinal,
                dataPagamento: dataPagtoFinal,
                banco: (bancoId && bancoId !== "") ? { connect: { id: bancoId } } : undefined,
                usuario: { connect: { id: usuarioId } }
            }
        });

        res.json(transacao);

    } catch (e) {
        console.error("ERRO GRAVE AO SALVAR TRANSAÇÃO:", e);
        res.status(500).json({ erro: "Erro ao salvar no banco de dados." });
    }
});

// ==========================================
// 2. LISTAR TRANSAÇÕES
// ==========================================
app.get('/transacoes', async (req, res) => {
    const { tipo, status, usuarioId } = req.query;
    const filtro = {};
    if (tipo) filtro.tipo = tipo;
    if (status) filtro.status = status;
    if (usuarioId) filtro.usuarioId = usuarioId; 

    try {
        const transacoes = await prisma.transacao.findMany({
            where: filtro,
            include: { banco: true },
            orderBy: { data: 'desc' }
        });
        res.json(transacoes);
    } catch (e) {
        res.status(500).json({ erro: "Erro ao listar" });
    }
});

// ==========================================
// 3. ATUALIZAR (Edição, Baixa e Estorno)
// ==========================================
app.put('/transacoes/:id', async (req, res) => {
    const { id } = req.params;
    const body = req.body;

    try {
        let dadosParaAtualizar = {};
        
        // CENÁRIO 1: ESTORNO (Voltar para Pendente)
        if (body.status === 'PENDENTE' && body.bancoId === null) {
            const transacaoAtual = await prisma.transacao.findUnique({ where: { id } });
            // Se não achar a transação, para aqui
            if (!transacaoAtual) return res.status(404).json({ erro: "Transação não encontrada" });

            const valorRestaurado = transacaoAtual.valorOriginal ? transacaoAtual.valorOriginal : transacaoAtual.valor;

            dadosParaAtualizar = {
                status: 'PENDENTE',
                banco: { disconnect: true },
                dataPagamento: null,
                juros: 0,
                desconto: 0,
                valor: valorRestaurado,
                valorOriginal: null
            };
        } 
        // CENÁRIO 2: PAGAMENTO (BAIXA)
        else if (body.status === 'PAGO' || body.status === 'RECEBIDO') {
             dadosParaAtualizar = {
                status: body.status,
                banco: { connect: { id: body.bancoId } },
                dataPagamento: new Date(body.dataPagamento),
                valor: parseFloat(body.valorFinal || body.valor), // Aceita ambos
                juros: parseFloat(body.juros || 0),
                desconto: parseFloat(body.desconto || 0)
            };
            const tr = await prisma.transacao.findUnique({ where: { id } });
            if (tr && !tr.valorOriginal) dadosParaAtualizar.valorOriginal = tr.valor;
        }
        // CENÁRIO 3: EDIÇÃO COMUM
        else {
            dadosParaAtualizar = {
                fornecedor: body.fornecedor,
                descricao: body.descricao,
                formaPagamento: body.formaPagamento,
                parcelas: body.parcelas ? parseInt(body.parcelas) : 1,
                categoria: body.categoria || 'Geral'
            };
            if (body.valor) dadosParaAtualizar.valor = parseFloat(String(body.valor).replace(',', '.'));
            if (body.dataVencimento) {
                const dt = new Date(body.dataVencimento.includes('T') ? body.dataVencimento : `${body.dataVencimento}T12:00:00`);
                dadosParaAtualizar.dataVencimento = dt;
                dadosParaAtualizar.data = dt;
            }
        }
        
        const transacao = await prisma.transacao.update({
            where: { id: id },
            data: dadosParaAtualizar
        });
        res.json(transacao);
    } catch (erro) {
        console.error("Erro ao atualizar:", erro);
        res.status(500).json({ erro: "Erro interno", detalhe: erro.message });
    }
});

// ==========================================
// 4. DELETAR
// ==========================================
app.delete('/transacoes/:id', async (req, res) => {
    try {
        await prisma.transacao.delete({ where: { id: req.params.id } });
        res.status(204).send();
    } catch(e) {
        res.status(500).json({ erro: "Erro ao deletar" });
    }
});

// ==========================================
// ROTAS AUXILIARES DE BAIXA (Compatibilidade)
// ==========================================
app.put('/transacoes/:id/baixar', async (req, res) => {
    const { id } = req.params;
    const { bancoId, dataPagamento, valorPago } = req.body;

    try {
        const original = await prisma.transacao.findUnique({ where: { id } });
        if (!original) return res.status(404).json({ erro: "Transação não encontrada" });

        const novoStatus = original.tipo === 'DESPESA' ? 'PAGO' : 'RECEBIDO';

        // Validação de Data Segura
        let dtPagto = new Date();
        if(dataPagamento) dtPagto = new Date(dataPagamento.includes('T') ? dataPagamento : `${dataPagamento}T12:00:00`);

        const atualizado = await prisma.transacao.update({
            where: { id },
            data: {
                status: novoStatus,
                bancoId: bancoId,
                dataPagamento: dtPagto,
                valor: parseFloat(valorPago)
            }
        });
        res.json(atualizado);
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "Erro ao dar baixa." });
    }
});

// ==========================================
// ROTA DE DASHBOARD
// ==========================================
app.get('/dashboard/resumo', async (req, res) => {
    const { usuarioId } = req.query;
    if (!usuarioId) return res.json({ saldoTotal: 0 });

    try {
        const hoje = new Date();
        const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);

        // 1. SALDO GERAL (Histórico completo)
        const bancos = await prisma.banco.findMany({ where: { usuarioId } });
        const saldoInicialTotal = bancos.reduce((acc, b) => acc + parseFloat(b.saldoInicial), 0);

        const totalRecebidoGeral = await prisma.transacao.aggregate({
            _sum: { valor: true },
            where: { usuarioId, tipo: 'RECEITA', status: 'RECEBIDO' }
        });

        const totalPagoGeral = await prisma.transacao.aggregate({
            _sum: { valor: true },
            where: { usuarioId, tipo: 'DESPESA', status: 'PAGO' }
        });

        const saldoTotal = saldoInicialTotal + (totalRecebidoGeral._sum.valor || 0) - (totalPagoGeral._sum.valor || 0);

        // 2. PREVISÃO DO MÊS
        const recMesTotal = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'RECEITA', data: { gte: inicioMes, lte: fimMes } } });
        const recMesReal = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'RECEITA', status: 'RECEBIDO', data: { gte: inicioMes, lte: fimMes } } });
        
        const despMesTotal = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'DESPESA', data: { gte: inicioMes, lte: fimMes } } });
        const despMesReal = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { usuarioId, tipo: 'DESPESA', status: 'PAGO', data: { gte: inicioMes, lte: fimMes } } });

        res.json({
            saldoTotal,
            receitaReal: recMesReal._sum.valor || 0,
            receitaTotal: recMesTotal._sum.valor || 0,
            despesaReal: despMesReal._sum.valor || 0,
            despesaTotal: despMesTotal._sum.valor || 0
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "Erro no dashboard" });
    }
});

// ==========================================
// ROTA DE EVENTOS (AGENDA)
// ==========================================
app.post('/eventos', async (req, res) => {
    const { titulo, descricao, data, tipo, usuarioId } = req.body;
    try {
        const evento = await prisma.evento.create({
            data: {
                titulo, descricao,
                data: new Date(data),
                tipo: tipo || 'TAREFA',
                usuario: { connect: { id: usuarioId } }
            }
        });
        res.json(evento);
    } catch (e) { res.status(500).json({ erro: "Erro ao criar evento" }); }
});

app.get('/eventos', async (req, res) => {
    const { usuarioId } = req.query;
    if (!usuarioId) return res.json([]);
    const eventos = await prisma.evento.findMany({ where: { usuarioId }, orderBy: { data: 'asc' } });
    res.json(eventos);
});

app.delete('/eventos/:id', async (req, res) => {
    await prisma.evento.delete({ where: { id: req.params.id } });
    res.status(204).send();
});

app.patch('/eventos/:id/toggle', async (req, res) => {
    const { id } = req.params;
    const { concluido } = req.body;
    const evento = await prisma.evento.update({ where: { id }, data: { concluido } });
    res.json(evento);
});

// ==========================================
// ROTA DE BANCOS
// ==========================================
app.get('/bancos', async (req, res) => {
    const { usuarioId } = req.query;
    if(!usuarioId) return res.json([]);

    try {
        const bancos = await prisma.banco.findMany({
            where: { usuarioId },
            include: {
                transacoes: {
                    where: { OR: [ { status: 'PAGO' }, { status: 'RECEBIDO' } ] }
                }
            },
            orderBy: { nome: 'asc' }
        });

        const bancosComSaldo = bancos.map(b => {
            let saldoAtual = parseFloat(b.saldoInicial);
            b.transacoes.forEach(t => {
                if (t.tipo === 'RECEITA') saldoAtual += t.valor;
                else if (t.tipo === 'DESPESA') saldoAtual -= t.valor;
            });
            return { ...b, saldoAtual, transacoes: undefined };
        });
        res.json(bancosComSaldo);
    } catch (e) { res.status(500).json({ erro: "Erro ao buscar bancos" }); }
});

app.post('/bancos', async (req, res) => {
    const { nome, agencia, conta, saldoInicial, dataSaldoInicial, inativo, usuarioId } = req.body;
    try {
        const banco = await prisma.banco.create({
            data: {
                nome, agencia, conta,
                saldoInicial: parseFloat(saldoInicial || 0),
                dataSaldoInicial: dataSaldoInicial ? new Date(dataSaldoInicial) : null,
                inativo: inativo === 'true' || inativo === true,
                usuario: { connect: { id: usuarioId } }
            }
        });
        res.json(banco);
    } catch (e) { res.status(500).json({ erro: "Erro ao criar banco" }); }
});

app.put('/bancos/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, agencia, conta, saldoInicial, dataSaldoInicial, inativo } = req.body;
    try {
        const banco = await prisma.banco.update({
            where: { id },
            data: {
                nome, agencia, conta,
                saldoInicial: parseFloat(saldoInicial || 0),
                dataSaldoInicial: dataSaldoInicial ? new Date(dataSaldoInicial) : null,
                inativo: inativo === 'true' || inativo === true
            }
        });
        res.json(banco);
    } catch (e) { res.status(500).json({ erro: "Erro ao atualizar banco" }); }
});

app.delete('/bancos/:id', async (req, res) => {
    try {
        await prisma.banco.delete({ where: { id: req.params.id } });
        res.status(204).send();
    } catch (e) { res.status(400).json({ erro: "Não é possível excluir banco com movimentações." }); }
});

// ==========================================
// ROTA DE USUÁRIOS
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
    } catch (e) {
        if (e.code === 'P2002') return res.status(400).json({ erro: "Email já está em uso." });
        res.status(500).json({ erro: "Erro ao atualizar usuário." });
    }
});

app.post('/usuarios/:id/reset-link', async (req, res) => {
    console.log(`[SIMULAÇÃO] Email enviado para ID: ${req.params.id}`);
    setTimeout(() => res.json({ mensagem: "Link enviado!" }), 1000);
});

// ==========================================
// ROTA DE IMPORTAÇÃO DE EXTRATO (OFX + JSON)
// ==========================================
app.post('/conciliacao/ler-ofx', upload.single('arquivo'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ erro: "Nenhum arquivo enviado." });

        const fileContent = req.file.buffer.toString('utf8');
        let transacoesLimpas = [];

        // 1. Tenta JSON (Infinity Pay)
        if (fileContent.trim().startsWith('{')) {
            try {
                const json = JSON.parse(fileContent);
                if (json.data && Array.isArray(json.data)) {
                    transacoesLimpas = json.data.map(t => {
                        const dataFinal = t.dateTime ? t.dateTime.split('T')[0] : new Date().toISOString().split('T')[0];
                        const valorReal = t.rawAmount ? t.rawAmount / 100 : 0;
                        const tipoTransacao = t.direction === 'in' ? 'RECEITA' : 'DESPESA';

                        return {
                            id_banco: t.id,
                            data: dataFinal,
                            descricao: t.title || "Sem descrição",
                            valor: Math.abs(valorReal),
                            tipo: tipoTransacao,
                            // AQUI ESTÁ O SEGREDO: Lemos o 'type' direto do banco (Cartão, Pix, etc)
                            formaOriginal: t.type || "Outros", 
                            rawValor: valorReal
                        };
                    });
                }
            } catch(e) { console.log("Não é JSON válido"); }
        }

        // 2. Tenta OFX
        if (transacoesLimpas.length === 0) {
            const data = ofx.parse(fileContent);
            let listaBruta = data.OFX?.BANKMSGSRSV1?.STMTTRNRS?.STMTRS?.BANKTRANLIST?.STMTTRN 
                          || data.OFX?.CREDITCARDMSGSRSV1?.CCSTMTTRNRS?.CCSTMTRS?.BANKTRANLIST?.STMTTRN;
            
            if (listaBruta) {
                const arr = Array.isArray(listaBruta) ? listaBruta : [listaBruta];
                transacoesLimpas = arr.map(t => {
                    const rawDate = (t.DTPOSTED || "").substring(0, 8);
                    const dt = rawDate.length === 8 
                        ? `${rawDate.substring(0, 4)}-${rawDate.substring(4, 6)}-${rawDate.substring(6, 8)}` 
                        : new Date().toISOString().split('T')[0];
                    const val = parseFloat(String(t.TRNAMT).replace(',', '.'));
                    return {
                        id_banco: t.FITID,
                        data: dt,
                        descricao: t.MEMO || "Sem descrição",
                        valor: Math.abs(val),
                        tipo: val < 0 ? 'DESPESA' : 'RECEITA'
                    };
                });
            }
        }

        if (transacoesLimpas.length === 0) return res.status(400).json({ erro: "Formato não reconhecido." });

        const resumo = {
            totalEntradas: transacoesLimpas.filter(t => t.tipo === 'RECEITA').reduce((a, t) => a + t.valor, 0),
            totalSaidas: transacoesLimpas.filter(t => t.tipo === 'DESPESA').reduce((a, t) => a + t.valor, 0),
            qtd: transacoesLimpas.length
        };

        res.json({ resumo, transacoes: transacoesLimpas });

    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "Erro ao ler arquivo." });
    }
});

// ==========================================
// AUTENTICAÇÃO
// ==========================================
app.post('/auth/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const usuario = await prisma.usuario.findUnique({ where: { email } });
        if (!usuario) return res.status(400).json({ erro: "Email não cadastrado." });
        
        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) return res.status(401).json({ erro: "Senha incorreta." });

        res.json({ id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role });
    } catch (e) { res.status(500).json({ erro: "Erro interno." }); }
});

app.post('/auth/registrar', async (req, res) => {
    const { nome, email, senha } = req.body;
    try {
        const existe = await prisma.usuario.findUnique({ where: { email } });
        if (existe) return res.status(400).json({ erro: "Email já em uso." });

        const hashSenha = await bcrypt.hash(senha, 10);
        const novoUsuario = await prisma.usuario.create({
            data: { nome, email, senha: hashSenha, role: 'USER' }
        });
        res.json(novoUsuario);
    } catch (e) { res.status(500).json({ erro: "Erro ao criar conta." }); }
});
// ==========================================
// 🔴 ROTA DE LIMPEZA (USAR COM CUIDADO)
// ==========================================
app.get('/limpar-tudo', async (req, res) => {
    try {
        // 1. Apaga TODAS as Transações (Receitas e Despesas)
        await prisma.transacao.deleteMany({});

        // 2. Apaga TODOS os Bancos (Para você cadastrar do zero com o saldo de hoje)
        // Se quiser MANTER os bancos e só apagar o extrato, remova a linha abaixo:
        await prisma.banco.deleteMany({});

        // 3. Apaga Eventos da Agenda
        await prisma.evento.deleteMany({});

        res.send(`
            <h1 style="font-family: sans-serif; color: green; text-align: center; margin-top: 50px;">
                ✅ Sistema Zerado com Sucesso!
            </h1>
            <p style="text-align: center; font-family: sans-serif;">
                Todas as transações e bancos foram excluídos.<br>
                Seu usuário foi mantido.<br>
                <br>
                <a href="http://localhost:3000/index.html">VOLTAR PARA O INÍCIO</a>
            </p>
        `);
    } catch (e) {
        console.error(e);
        res.status(500).send("Erro ao limpar dados: " + e.message);
    }
});

// ==========================================
// ROTA DE RELATÓRIOS AVANÇADOS (INTELIGÊNCIA)
// ==========================================
app.get('/relatorios/avancado', async (req, res) => {
    const { usuarioId, inicio, fim } = req.query;
    if (!usuarioId) return res.json({});

    try {
        // Define o período (Se não vier, pega o mês atual)
        const hoje = new Date();
        const dataInicio = inicio ? new Date(inicio + "T00:00:00") : new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        const dataFim = fim ? new Date(fim + "T23:59:59") : new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);

        const filtroComum = {
            usuarioId,
            status: 'PAGO', // Só conta o que saiu de verdade
            tipo: 'DESPESA', // Foco em gastos
            dataPagamento: { gte: dataInicio, lte: dataFim }
        };

        // 1. TOTAL POR FORMA DE PAGAMENTO (Para o Gráfico)
        const porForma = await prisma.transacao.groupBy({
            by: ['formaPagamento'],
            _sum: { valor: true },
            where: filtroComum
        });

        // 2. TOP FORNECEDORES (Quem gasta mais)
        const porFornecedor = await prisma.transacao.groupBy({
            by: ['fornecedor'],
            _sum: { valor: true },
            where: filtroComum,
            orderBy: { _sum: { valor: 'desc' } },
            take: 5 // Pega os top 5
        });

        // 3. DADOS ESPECÍFICOS DE CARTÃO
        const gastosCartao = await prisma.transacao.aggregate({
            _sum: { valor: true },
            _avg: { valor: true }, // Ticket médio
            _count: { id: true },
            where: {
                ...filtroComum,
                formaPagamento: { in: ['Cartão', 'Crédito', 'Credit Card'] } // Ajuste conforme seus nomes
            }
        });

        // 4. TOTAL GERAL DO PERÍODO
        const totalGeral = await prisma.transacao.aggregate({
            _sum: { valor: true },
            where: filtroComum
        });

        res.json({
            porForma,
            porFornecedor,
            cartao: {
                total: gastosCartao._sum.valor || 0,
                media: gastosCartao._avg.valor || 0,
                qtd: gastosCartao._count.id || 0
            },
            totalGeral: totalGeral._sum.valor || 0
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "Erro ao gerar relatórios" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); });