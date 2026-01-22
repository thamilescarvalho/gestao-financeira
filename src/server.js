import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// --- ROTA DE CRIAR TRANSAÇÃO ---
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

// --- ROTA DE LISTAR ---
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

// --- ROTA INTELIGENTE: EDITAR, BAIXAR E ESTORNAR ---
app.put('/transacoes/:id', async (req, res) => {
    const { id } = req.params;
    const body = req.body;

    try {
        let dadosParaAtualizar = {};

        // CENÁRIO 1: ESTORNO (Voltar para Pendente)
        if (body.status === 'PENDENTE' && body.bancoId === null) {
            console.log(`Estornando transação ${id}...`);
            
            // Passo 1: Busca a transação atual para saber o valor original
            const transacaoAtual = await prisma.transacao.findUnique({ where: { id } });
            
            // Se tiver valorOriginal salvo, recupera ele. Se não, mantém o valor atual.
            const valorRestaurado = transacaoAtual.valorOriginal ? transacaoAtual.valorOriginal : transacaoAtual.valor;

            dadosParaAtualizar = {
                status: 'PENDENTE',
                banco: { disconnect: true }, // Jeito certo de remover o banco no Prisma
                dataPagamento: null,
                juros: 0,
                desconto: 0,
                valor: valorRestaurado, // Restaura o valor original
                valorOriginal: null     // Limpa o backup do valor original
            };
        } 
        // CENÁRIO 2: PAGAMENTO (BAIXA)
        else if (body.status === 'PAGO') {
             dadosParaAtualizar = {
                status: 'PAGO',
                banco: { connect: { id: body.bancoId } },
                dataPagamento: new Date(body.dataPagamento),
                
                // Salva o valor antigo no campo 'valorOriginal' antes de atualizar
                // (Isso é feito automaticamente se você não sobrescrever, mas vamos garantir na lógica de negócio se precisar)
                // Aqui estamos assumindo que o body.valorFinal é o valor pago com juros/descontos
                
                valor: parseFloat(body.valorFinal), // Atualiza o valor principal para o valor pago
                // Opcional: Se quiser salvar o original, teria que ter lido antes ou enviado do front. 
                // Por simplificação, vamos assumir que o valor que estava lá já era o original.
                
                juros: parseFloat(body.juros || 0),
                desconto: parseFloat(body.desconto || 0)
            };
            
            // Pequeno truque: Se estamos baixando, vamos salvar o valor atual como valorOriginal (se ainda não tiver)
            const tr = await prisma.transacao.findUnique({ where: { id } });
            if (!tr.valorOriginal) {
                dadosParaAtualizar.valorOriginal = tr.valor;
            }
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

            // Só atualiza valor se ele foi enviado
            if (body.valor) {
                dadosParaAtualizar.valor = parseFloat(String(body.valor).replace(',', '.'));
            }

            if (body.dataVencimento) {
                const dataFormatada = new Date(body.dataVencimento + "T12:00:00Z");
                dadosParaAtualizar.dataVencimento = dataFormatada;
                dadosParaAtualizar.data = dataFormatada;
            }
        }

        const transacao = await prisma.transacao.update({
            where: { id: id },
            data: dadosParaAtualizar
        });
        
        res.json(transacao);

    } catch (erro) {
        console.error("Erro no Servidor:", erro);
        // Retorna o erro detalhado para facilitar
        res.status(500).json({ erro: "Erro interno", detalhe: erro.meta ? erro.meta.cause : erro.message });
    }
});

// --- ROTA DE PAGAR (ANTIGA - MANTIDA PARA COMPATIBILIDADE, MAS A DE CIMA JÁ FAZ ISSO) ---
app.put('/transacoes/:id/pagar', async (req, res) => {
    // Redireciona logicamente para a rota de cima, ou mantém separado.
    // Como a rota PUT /transacoes/:id já trata o 'status: PAGO', essa aqui fica redundante, 
    // mas vamos manter para não quebrar nada antigo.
    const { id } = req.params;
    const { bancoId, dataPagamento, juros, desconto, valorFinal } = req.body;
    try {
        const transacao = await prisma.transacao.update({
            where: { id },
            data: {
                status: 'PAGO',
                banco: { connect: { id: bancoId } },
                dataPagamento: new Date(dataPagamento),
                juros: parseFloat(juros || 0),
                desconto: parseFloat(desconto || 0),
                valor: parseFloat(valorFinal) // Atualiza valor se necessário, ou usa valorFinal em campo separado (depende do seu schema)
            }
        });
        return res.json(transacao);
    } catch (error) { return res.status(500).json({ erro: "Erro ao pagar" }); }
});

// --- ROTA DE DELETAR (DEFINITIVO) ---
app.delete('/transacoes/:id', async (req, res) => {
    await prisma.transacao.delete({ where: { id: req.params.id } });
    return res.status(204).send();
});

// --- ROTAS AUXILIARES (RESUMO, BANCOS, USUARIOS) ---
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

app.post('/bancos', async (req, res) => {
    const { nome, cor, usuarioId, agencia, conta, saldoInicial, dataSaldo, inativo } = req.body;
    try {
        const novoBanco = await prisma.banco.create({
            data: { nome, cor, agencia, conta, saldoInicial: parseFloat(saldoInicial || 0), dataSaldo: dataSaldo ? new Date(dataSaldo) : new Date(), inativo: inativo === 'sim', usuario: { connect: { id: usuarioId } } }
        });
        return res.json(novoBanco);
    } catch (error) { return res.status(500).json({ erro: "Erro ao criar banco." }); }
});

app.put('/bancos/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, agencia, conta, saldoInicial, dataSaldo, inativo } = req.body;
    try {
        const banco = await prisma.banco.update({
            where: { id },
            data: { nome, agencia, conta, saldoInicial: parseFloat(saldoInicial || 0), dataSaldo: dataSaldo ? new Date(dataSaldo) : undefined, inativo: inativo === 'sim' }
        });
        return res.json(banco);
    } catch (error) { return res.status(500).json({ erro: "Erro ao atualizar." }); }
});

app.delete('/bancos/:id', async (req, res) => {
    await prisma.banco.delete({ where: { id: req.params.id } });
    return res.status(200).send();
});

// LOGIN E REGISTRO
app.post('/registro', async (req, res) => {
    const { nome, email, senha } = req.body;
    const exists = await prisma.usuario.findUnique({ where: { email } });
    if (exists) return res.status(400).json({ erro: "Email já cadastrado!" });
    const hashSenha = await bcrypt.hash(senha, 10);
    const novoUsuario = await prisma.usuario.create({ data: { nome, email, senha: hashSenha } });
    return res.json({ sucesso: true, usuario: novoUsuario });
});

app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (!usuario || !(await bcrypt.compare(senha, usuario.senha))) return res.status(401).json({ sucesso: false, erro: "Credenciais inválidas!" });
    return res.json({ sucesso: true, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email } });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); });