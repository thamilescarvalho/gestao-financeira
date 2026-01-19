import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client'; // 1. Importamos o conector do banco

const prisma = new PrismaClient(); // 2. Iniciamos a conexão
const app = express();

app.use(express.json());
app.use(cors());

// --- LINHA NOVA: Servir arquivos estáticos (HTML, CSS, Imagens) ---
// Isso diz: "Tudo que estiver na pasta 'public', pode mostrar pro navegador"
app.use(express.static('public'));

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

// --- ROTA DE CADASTRO (CRIAR CONTA) ---
app.post('/registro', async (req, res) => {
    const { nome, email, senha } = req.body;

    // 1. Verifica se já existe esse email
    const usuarioExistente = await prisma.usuario.findUnique({ where: { email } });
    if (usuarioExistente) {
        return res.status(400).json({ erro: "Email já cadastrado!" });
    }

    // 2. Criptografa a senha (segurança máxima)
    const hashSenha = await bcrypt.hash(senha, 10);

    // 3. Salva no banco
    const novoUsuario = await prisma.usuario.create({
        data: {
            nome,
            email,
            senha: hashSenha
        }
    });

    return res.json({ sucesso: true, usuario: novoUsuario });
});

// --- ROTA DE LOGIN (ENTRAR) ---
app.post('/login', async (req, res) => {
    const { email, senha } = req.body;

    // 1. Procura o usuário pelo email
    const usuario = await prisma.usuario.findUnique({ where: { email } });

    if (!usuario) {
        return res.status(400).json({ sucesso: false, erro: "Usuário não encontrado!" });
    }

    // 2. Compara a senha digitada com a criptografada do banco
    const senhaValida = await bcrypt.compare(senha, usuario.senha);

    if (!senhaValida) {
        return res.status(401).json({ sucesso: false, erro: "Senha incorreta!" });
    }

    // 3. Deu certo! Retorna os dados (sem a senha, claro)
    return res.json({ 
        sucesso: true, 
        token: "TOKEN_SECRET_" + usuario.id, // Simulação de token
        usuario: { nome: usuario.nome, email: usuario.email }
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});