import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client'; // 1. Importamos o conector do banco

const prisma = new PrismaClient(); // 2. Iniciamos a conexão
const app = express();

app.use(express.json());
app.use(cors());

// --- ROTA 1: CRIAR UMA CONTA (POST) ---
app.post('/transacoes', async (req, res) => {
    // Pegamos os dados que foram enviados no "corpo" da requisição
    const { descricao, valor, tipo, categoria } = req.body;

    // Mandamos o Prisma salvar no banco
    const transacaoCriada = await prisma.transacao.create({
        data: {
            descricao,
            valor,
            tipo,
            categoria
        }
    });

    // Devolvemos a transação criada como confirmação
    return res.status(201).json(transacaoCriada);
});

// --- ROTA 2: LISTAR COM FILTROS (AS "ABAS") ---
app.get('/transacoes', async (req, res) => {
    // 1. Capturamos os filtros que vêm na URL (Ex: ?tipo=DESPESA)
    const { tipo, status } = req.query;

    // 2. Montamos a regra de pesquisa dinamicamente
    const filtros = {};
    
    // Se o usuário pediu um tipo específico, adicionamos ao filtro
    if (tipo) {
        filtros.tipo = tipo;
    }

    // Se o usuário pediu um status específico, adicionamos
    if (status) {
        filtros.status = status;
    }

    // 3. Buscamos no banco usando os filtros
    const lista = await prisma.transacao.findMany({
        where: filtros,
        orderBy: { data: 'desc' } // Ordena do mais recente para o antigo
    });
    
    return res.json(lista);
});

// --- ROTA 3: BAIXAR UMA CONTA (MARCAR COMO PAGO) ---
// O :id indica que vamos receber o ID da conta pela URL
app.patch('/transacoes/:id', async (req, res) => {
    const { id } = req.params;

    // Atualiza o registro no banco
    const transacaoAtualizada = await prisma.transacao.update({
        where: { id: id }, // Procura pelo ID
        data: { 
            status: "PAGO",         // Muda o status
            dataPagamento: new Date() // Grava a data/hora exata de agora
        }
    });

    return res.json(transacaoAtualizada);
});

// --- ROTA 4: DELETAR UMA CONTA (CASO ERROU) ---
app.delete('/transacoes/:id', async (req, res) => {
    const { id } = req.params;

    await prisma.transacao.delete({
        where: { id: id }
    });

    return res.status(204).send(); // 204 = Sucesso, mas sem conteúdo para mostrar
});

const PORT = 3000;

// --- ROTA 5: RESUMO FINANCEIRO (DASHBOARD) ---
app.get('/resumo', async (req, res) => {
    // 1. Pede pro banco somar todas as RECEITAS
    const totalReceitas = await prisma.transacao.aggregate({
        _sum: { valor: true },
        where: { tipo: 'RECEITA' } // <-- Corrigido para 'tipo'
    });

    // 2. Pede pro banco somar todas as DESPESAS
    const totalDespesas = await prisma.transacao.aggregate({
        _sum: { valor: true },
        where: { tipo: 'DESPESA' } // <-- Corrigido para 'tipo'
    });

    // 3. Organiza os valores (se for null, vira zero)
    // O 'Number(...)' garante que seja tratado como número
    const receitas = Number(totalReceitas._sum.valor || 0);
    const despesas = Number(totalDespesas._sum.valor || 0);
    const saldo = receitas - despesas;

    return res.json({
        receitas,
        despesas,
        saldo
    });
});

// --- ROTA 6: CONCILIAÇÃO BANCÁRIA (AUTOMÁTICA) ---
app.post('/conciliacao', async (req, res) => {
    const extratoBancario = req.body; // Recebe uma lista de itens do banco
    const relatorio = [];

    // Para cada linha do extrato bancário...
    for (const itemBanco of extratoBancario) {
        
        // ...o sistema procura no DB uma conta com mesmo valor e tipo
        const possivelMatch = await prisma.transacao.findFirst({
            where: {
                valor: itemBanco.valor,
                tipo: itemBanco.tipo,
                status: "PENDENTE" // Só busca o que ainda não foi pago
            }
        });

        // Adiciona ao relatório o resultado da investigação
        relatorio.push({
            transacao_banco: itemBanco.descricao,
            valor: itemBanco.valor,
            status_conciliacao: possivelMatch ? "ENCONTRADO" : "NÃO ENCONTRADO",
            id_sistema: possivelMatch ? possivelMatch.id : null,
            acao_sugerida: possivelMatch ? "CONFIRMAR BAIXA" : "CADASTRAR NOVA CONTA"
        });
    }

    return res.json(relatorio);
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});