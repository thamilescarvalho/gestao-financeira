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
// ROTAS DA AGENDA (ROTINA) - NOVO!
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
// ROTAS AUXILIARES (BANCOS, USUÁRIOS, LOGIN)
// ==========================================

app.get('/resumo', async (req, res) => {
    const totalReceitas = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { tipo: 'RECEITA' } });
    const totalDespesas = await prisma.transacao.aggregate({ _sum: { valor: true }, where: { tipo: 'DESPESA' } });
    return res.json({ receitas: Number(totalReceitas._sum.valor || 0), despesas: Number(totalDespesas._sum.valor || 0), saldo: Number(totalReceitas._sum.valor || 0) - Number(totalDespesas._sum.valor || 0) });
});

app.get('/bancos', async (req, res) => {
    const { usuarioId } = req.query; 
    if(!usuarioId) return res.json([]);
    const bancos = await prisma.banco.findMany({ where: { usuarioId } });
    return res.json(bancos);
});

app.post('/bancos', async (req, res) => { /* Mesma lógica anterior */ 
    const { nome, cor, usuarioId } = req.body;
    const b = await prisma.banco.create({ data: { nome, cor, usuario: { connect: { id: usuarioId } } } });
    res.json(b);
});

app.post('/registro', async (req, res) => {
    const { nome, email, senha } = req.body;
    const exists = await prisma.usuario.findUnique({ where: { email } });
    if (exists) return res.status(400).json({ erro: "Email já cadastrado!" });
    const hashSenha = await bcrypt.hash(senha, 10);
    const user = await prisma.usuario.create({ data: { nome, email, senha: hashSenha } });
    return res.json({ sucesso: true, usuario: user });
});

app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    const user = await prisma.usuario.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(senha, user.senha))) return res.status(401).json({ sucesso: false, erro: "Credenciais inválidas!" });
    return res.json({ sucesso: true, usuario: { id: user.id, nome: user.nome, email: user.email } });
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
// --- ATUALIZAÇÃO NO SERVER.JS (Substitua ou adicione na área de Usuários) ---

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); });