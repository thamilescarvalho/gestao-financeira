import multer from 'multer';
import ofx from 'node-ofx-parser';

import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// ==========================================
// ROTAS DE TRANSAÇÕES (FINANCEIRO)
// ==========================================
// 1. CRIAR
app.post('/transacoes', async (req, res) => {
    const { 
        fornecedor, descricao, valor, tipo, categoria, 
        data, dataVencimento, formaPagamento, 
        parcelas = 1, bancoId, usuarioId 
    } = req.body;

    if (!usuarioId) return res.status(400).json({ erro: "Usuário não identificado." });

    const listaCriada = [];
    let dataVencimentoAtual = new Date(dataVencimento);
    const dataCompetencia = new Date(data);

    try {
        for (let i = 0; i < parcelas; i++) {
            const sufixo = parcelas > 1 ? ` (${i + 1}/${parcelas})` : '';
            const novaTransacao = await prisma.transacao.create({
                data: {
                    fornecedor,
                    descricao: descricao + sufixo,
                    valor: parseFloat(valor),
                    tipo,
                    categoria,
                    status: "PENDENTE",
                    data: dataCompetencia,
                    dataVencimento: dataVencimentoAtual,
                    formaPagamento,
                    usuario: { connect: { id: usuarioId } },
                    ...(bancoId && { banco: { connect: { id: bancoId } } })
                }
            });
            listaCriada.push(novaTransacao);
            dataVencimentoAtual.setMonth(dataVencimentoAtual.getMonth() + 1);
        }
        return res.json(listaCriada);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ erro: "Erro ao salvar" });
    }
});
// 2. LISTAR
app.get('/transacoes', async (req, res) => {
    const { tipo, status, usuarioId } = req.query;
    const filtro = {};
    if (tipo) filtro.tipo = tipo;
    if (status) filtro.status = status;
    if (usuarioId) filtro.usuarioId = usuarioId; 

    const transacoes = await prisma.transacao.findMany({
        where: filtro,
        include: { banco: true },
        orderBy: { data: 'desc' }
    });
    return res.json(transacoes);
});
// 3. ATUALIZAR (Edição, Baixa e Estorno)
app.put('/transacoes/:id', async (req, res) => {
    const { id } = req.params;
    const body = req.body;

    try {
        let dadosParaAtualizar = {};
        // CENÁRIO 1: ESTORNO
        if (body.status === 'PENDENTE' && body.bancoId === null) {
            const transacaoAtual = await prisma.transacao.findUnique({ where: { id } });
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
        else if (body.status === 'PAGO') {
             dadosParaAtualizar = {
                status: 'PAGO',
                banco: { connect: { id: body.bancoId } },
                dataPagamento: new Date(body.dataPagamento),
                valor: parseFloat(body.valorFinal),
                juros: parseFloat(body.juros || 0),
                desconto: parseFloat(body.desconto || 0)
            };
            const tr = await prisma.transacao.findUnique({ where: { id } });
            if (!tr.valorOriginal) dadosParaAtualizar.valorOriginal = tr.valor;
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
                const dt = new Date(body.dataVencimento + "T12:00:00Z");
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
        console.error("Erro no Servidor:", erro);
        res.status(500).json({ erro: "Erro interno", detalhe: erro.message });
    }
});
// 4. DELETAR
app.delete('/transacoes/:id', async (req, res) => {
    await prisma.transacao.delete({ where: { id: req.params.id } });
    return res.status(204).send();
});
// ROTAS ANTIGAS DE PAGAR (MANTIDAS PARA SEGURANÇA)
app.put('/transacoes/:id/pagar', async (req, res) => {
    // Redireciona para lógica do PUT principal se possível, ou mantém simples aqui
    const { id } = req.params;
    const { bancoId, dataPagamento, valorFinal } = req.body;
    try {
        await prisma.transacao.update({
            where: { id },
            data: { 
                status: 'PAGO', 
                banco: { connect: { id: bancoId } }, 
                dataPagamento: new Date(dataPagamento), 
                valor: parseFloat(valorFinal)
            }
        });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ erro: "Erro" }); }
});
// ==========================================
// ROTA DE DASHBOARD (RESUMO FINANCEIRO)
// ==========================================
app.get('/dashboard/resumo', async (req, res) => {
    const { usuarioId } = req.query;
    if (!usuarioId) return res.json({ saldoTotal: 0, receitasMes: 0, despesasMes: 0 });

    try {
        const hoje = new Date();
        const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);

        // 1. Soma Saldos Iniciais dos Bancos
        const bancos = await prisma.banco.findMany({ where: { usuarioId } });
        const saldoInicialTotal = bancos.reduce((acc, b) => acc + b.saldoInicial, 0);

        // 2. Soma Todas as Receitas e Despesas (Para o Saldo Atual Global)
        const agregadoGeral = await prisma.transacao.groupBy({
            by: ['tipo'],
            where: { usuarioId },
            _sum: { valor: true }
        });

        // 3. Soma Receitas e Despesas APENAS do Mês Atual
        const agregadoMes = await prisma.transacao.groupBy({
            by: ['tipo'],
            where: { 
                usuarioId,
                data: { gte: inicioMes, lte: fimMes }
            },
            _sum: { valor: true }
        });

        // Processa os números gerais
        let totalReceitas = 0;
        let totalDespesas = 0;
        agregadoGeral.forEach(item => {
            if (item.tipo === 'RECEITA') totalReceitas = item._sum.valor || 0;
            if (item.tipo === 'DESPESA') totalDespesas = item._sum.valor || 0;
        });

        // Processa os números do mês
        let mesReceitas = 0;
        let mesDespesas = 0;
        agregadoMes.forEach(item => {
            if (item.tipo === 'RECEITA') mesReceitas = item._sum.valor || 0;
            if (item.tipo === 'DESPESA') mesDespesas = item._sum.valor || 0;
        });

        // Cálculo Final
        const saldoTotal = saldoInicialTotal + totalReceitas - totalDespesas;

        res.json({
            saldoTotal,
            receitasMes: mesReceitas,
            despesasMes: mesDespesas
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "Erro ao calcular dashboard" });
    }
});

// Rota para pegar as 5 últimas transações
app.get('/dashboard/ultimas', async (req, res) => {
    const { usuarioId } = req.query;
    try {
        const ultimas = await prisma.transacao.findMany({
            where: { usuarioId },
            orderBy: { data: 'desc' },
            take: 5, // Pega apenas as 5 mais recentes
            include: { banco: true } // Traz o nome do banco junto
        });
        res.json(ultimas);
    } catch (e) {
        res.status(500).json({ erro: "Erro ao buscar ultimas" });
    }
});
// ==========================================
// ROTAS DA AGENDA (ROTINA)
// ==========================================
// 1. Criar Evento
app.post('/eventos', async (req, res) => {
    const { titulo, descricao, data, tipo, usuarioId } = req.body;
    try {
        const evento = await prisma.evento.create({
            data: {
                titulo,
                descricao,
                data: new Date(data),
                tipo: tipo || 'TAREFA',
                usuario: { connect: { id: usuarioId } }
            }
        });
        res.json(evento);
    } catch (e) { 
        console.error(e);
        res.status(500).json({ erro: "Erro ao criar evento" }); 
    }
});
// 2. Listar Eventos
app.get('/eventos', async (req, res) => {
    const { usuarioId } = req.query;
    if (!usuarioId) return res.json([]);
    
    const eventos = await prisma.evento.findMany({
        where: { usuarioId },
        orderBy: { data: 'asc' }
    });
    res.json(eventos);
});
// 3. Excluir Evento
app.delete('/eventos/:id', async (req, res) => {
    await prisma.evento.delete({ where: { id: req.params.id } });
    res.status(204).send();
});
// 4. Marcar como Feito (Check)
app.patch('/eventos/:id/toggle', async (req, res) => {
    const { id } = req.params;
    const { concluido } = req.body;
    const evento = await prisma.evento.update({
        where: { id },
        data: { concluido }
    });
    res.json(evento);
});
// ==========================================
// ROTAS DE BANCOS (CRUD COMPLETO)
// ==========================================
// 1. Listar Bancos
app.get('/bancos', async (req, res) => {
    const { usuarioId } = req.query; 
    if(!usuarioId) return res.json([]);
    const bancos = await prisma.banco.findMany({ 
        where: { usuarioId },
        orderBy: { nome: 'asc' }
    });
    res.json(bancos);
});
// 2. Criar Banco
app.post('/bancos', async (req, res) => {
    const { nome, agencia, conta, saldoInicial, dataSaldoInicial, inativo, usuarioId } = req.body;
    try {
        const banco = await prisma.banco.create({
            data: {
                nome,
                agencia,
                conta,
                saldoInicial: parseFloat(saldoInicial || 0),
                dataSaldoInicial: dataSaldoInicial ? new Date(dataSaldoInicial) : null,
                inativo: inativo === 'true' || inativo === true,
                usuario: { connect: { id: usuarioId } }
            }
        });
        res.json(banco);
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "Erro ao criar banco" });
    }
});
// 3. ATUALIZAR BANCO (O que faltava!)
app.put('/bancos/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, agencia, conta, saldoInicial, dataSaldoInicial, inativo } = req.body;
    try {
        const banco = await prisma.banco.update({
            where: { id },
            data: {
                nome,
                agencia,
                conta,
                saldoInicial: parseFloat(saldoInicial || 0),
                dataSaldoInicial: dataSaldoInicial ? new Date(dataSaldoInicial) : null,
                inativo: inativo === 'true' || inativo === true
            }
        });
        res.json(banco);
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "Erro ao atualizar banco" });
    }
});
// 4. Excluir Banco
app.delete('/bancos/:id', async (req, res) => {
    try {
        await prisma.banco.delete({ where: { id: req.params.id } });
        res.status(204).send();
    } catch (e) {
        // Se tiver transações vinculadas, vai dar erro.
        res.status(400).json({ erro: "Não é possível excluir banco com movimentações." });
    }
});
// ==========================================
// ROTAS DE USUÁRIOS (GESTÃO DE PERMISSÕES)
// ==========================================
// 1. Listar usuários (Agora inclui o ROLE)
app.get('/usuarios', async (req, res) => {
    try {
        const usuarios = await prisma.usuario.findMany({
            select: { 
                id: true, nome: true, email: true, role: true // <--- Pegamos o cargo agora
            },
            orderBy: { nome: 'asc' }
        });
        res.json(usuarios);
    } catch (e) {
        res.status(500).json({ erro: "Erro ao buscar usuários" });
    }
});
// 2. Alterar Permissão (Role)
app.patch('/usuarios/:id/role', async (req, res) => {
    const { role } = req.body; // Espera receber "ADMIN" ou "USER"
    try {
        const usuario = await prisma.usuario.update({
            where: { id: req.params.id },
            data: { role }
        });
        res.json(usuario);
    } catch (e) {
        res.status(500).json({ erro: "Erro ao alterar permissão" });
    }
});

// 3. Excluir usuário
app.delete('/usuarios/:id', async (req, res) => {
    try {
        await prisma.usuario.delete({ where: { id: req.params.id } });
        res.status(204).send();
    } catch (e) {
        res.status(500).json({ erro: "Erro ao excluir" });
    }
});
// 1. Rota unificada para EDITAR USUÁRIO (Nome, Email, Role e Senha)
app.put('/usuarios/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, email, role, novaSenha } = req.body;
    try {
        const dadosParaAtualizar = { nome, email, role };
        // Se o admin digitou uma nova senha, criptografa e atualiza
        if (novaSenha && novaSenha.trim() !== '') {
            const hashSenha = await bcrypt.hash(novaSenha, 10);
            dadosParaAtualizar.senha = hashSenha;
        }
        const usuario = await prisma.usuario.update({
            where: { id },
            data: dadosParaAtualizar
        });
        res.json(usuario);
    } catch (e) {
        console.error(e);
        // Erro comum: Email já existe (P2002 no Prisma)
        if (e.code === 'P2002') return res.status(400).json({ erro: "Email já está em uso." });
        res.status(500).json({ erro: "Erro ao atualizar usuário." });
    }
});
// 2. Rota para SIMULAR envio de link de recuperação
app.post('/usuarios/:id/reset-link', async (req, res) => {
    // AQUI entraria a lógica de enviar email real (Nodemailer, Sendgrid, etc)
    // Por enquanto, apenas simulamos o sucesso.
    console.log(`[SIMULAÇÃO] Enviando email de recuperação para o ID: ${req.params.id}`);
    
    // Simula um delay de envio
    setTimeout(() => {
        res.json({ mensagem: "Link enviado com sucesso!" });
    }, 1000);
});
// ==========================================
// CONFIGURAÇÃO DE UPLOAD E OFX (VERSÃO ESM)
// ==========================================
// Configura o armazenamento em memória RAM
const upload = multer({ storage: multer.memoryStorage() });
// Rota para LER o arquivo OFX e devolver os dados
app.post('/conciliacao/ler-ofx', upload.single('arquivo'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ erro: "Nenhum arquivo enviado." });
        }
        const ofxData = req.file.buffer.toString('utf8');
        // Faz o parse do OFX
        const data = ofx.parse(ofxData);
        // Navega na estrutura do OFX para achar as transações
        // Tenta localizar a lista de transações (BANKTRANLIST -> STMTTRN)
        let transacoes = [];
        // Verifica se a estrutura existe antes de tentar acessar
        const bankMsgs = data.OFX?.BANKMSGSRSV1?.STMTTRNRS?.STMTRS?.BANKTRANLIST?.STMTTRN;    
        if (!bankMsgs) {
             return res.status(400).json({ erro: "Não foi possível ler as transações deste OFX. Formato inesperado." });
        }
        // Se for um array (várias) ou objeto único (uma)
        const listaBruta = Array.isArray(bankMsgs) ? bankMsgs : [bankMsgs];

        transacoes = listaBruta.map(t => {
            // Formata Data (OFX vem como AAAAMMDD...)
            // Exemplo OFX: 20260122120000
            const rawDate = t.DTPOSTED.substring(0, 8); 
            const ano = rawDate.substring(0, 4);
            const mes = rawDate.substring(4, 6);
            const dia = rawDate.substring(6, 8);
            
            return {
                data: `${ano}-${mes}-${dia}`,
                descricao: t.MEMO || "Sem descrição",
                valor: parseFloat(t.TRNAMT),
                id_banco: t.FITID, 
                tipo: parseFloat(t.TRNAMT) < 0 ? 'DESPESA' : 'RECEITA'
            };
        });
        res.json(transacoes);
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "Erro ao ler arquivo OFX. Verifique o formato." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); });