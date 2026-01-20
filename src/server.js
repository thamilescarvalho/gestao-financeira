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

// --- ROTA DE CRIAR TRANSAÇÃO (VINCULADA AO USUÁRIO) ---
app.post('/transacoes', async (req, res) => {
    const { 
        descricao, valor, tipo, categoria, 
        data, dataVencimento, formaPagamento, 
        parcelas = 1, 
        bancoId,
        usuarioId // <--- AGORA RECEBEMOS O ID DO USUÁRIO
    } = req.body;

    if (!usuarioId) {
        return res.status(400).json({ erro: "Usuário não identificado." });
    }

    const listaCriada = [];
    let dataVencimentoAtual = new Date(dataVencimento);
    const dataCompetencia = new Date(data);

    try {
        for (let i = 0; i < parcelas; i++) {
            const sufixo = parcelas > 1 ? ` (${i + 1}/${parcelas})` : '';
            
            const novaTransacao = await prisma.transacao.create({
                data: {
                    descricao: descricao + sufixo,
                    valor: parseFloat(valor),
                    tipo,
                    categoria,
                    status: "PENDENTE",
                    data: dataCompetencia,
                    dataVencimento: dataVencimentoAtual,
                    formaPagamento,
                    // Conexões importantes:
                    usuario: { connect: { id: usuarioId } }, // Vincula ao Usuário
                    ...(bancoId && { banco: { connect: { id: bancoId } } }) // Se tiver banco, vincula também
                }
            });
            
            listaCriada.push(novaTransacao);
            dataVencimentoAtual.setMonth(dataVencimentoAtual.getMonth() + 1);
        }

        return res.json(listaCriada);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ erro: "Erro ao criar transação." });
    }
});

// --- ROTA DE LISTAR TRANSAÇÕES (ATUALIZADA) ---
app.get('/transacoes', async (req, res) => {
    const { tipo, status, usuarioId } = req.query;

    const filtro = {};
    if (tipo) filtro.tipo = tipo;
    if (status) filtro.status = status;
    // Se mandar o ID do usuário, filtra. Se não, traz tudo (cuidado em produção!)
    if (usuarioId) filtro.usuarioId = usuarioId; 

    const transacoes = await prisma.transacao.findMany({
        where: filtro,
        include: {
            banco: true // <--- ISSO É O SEGREDO! Traz os dados do Banco junto
        },
        orderBy: {
            data: 'desc' // Ordena do mais recente para o mais antigo
        }
    });

    return res.json(transacoes);
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
        usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email }
    });
});

// --- ROTAS DE BANCOS ---

// 1. Listar meus bancos
app.get('/bancos', async (req, res) => {
    // Pegar o ID do usuário que virá do frontend (vamos implementar isso já já)
    const { usuarioId } = req.query; 
    
    if(!usuarioId) return res.json([]);

    const bancos = await prisma.banco.findMany({
        where: { usuarioId }
    });
    return res.json(bancos);
});

// --- ROTA DE CRIAR BANCO ---
app.post('/bancos', async (req, res) => {
    // Pegamos todos os campos novos do formulário
    const { nome, cor, usuarioId, agencia, conta, saldoInicial, dataSaldo, inativo } = req.body;

    if (!usuarioId) {
        return res.status(400).json({ erro: "Usuário não identificado." });
    }

    try {
        const novoBanco = await prisma.banco.create({
            data: { 
                nome, 
                cor,
                agencia,
                conta,
                saldoInicial: parseFloat(saldoInicial || 0), // Converte para número
                dataSaldo: dataSaldo ? new Date(dataSaldo) : new Date(),
                inativo: inativo === 'sim', // Se vier "sim" vira true, senão false
                usuario: { connect: { id: usuarioId } }
            }
        });
        return res.json(novoBanco);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ erro: "Erro ao criar banco." });
    }
});

// --- ROTA DE ATUALIZAR BANCO (EDITAR) ---
app.put('/bancos/:id', async (req, res) => {
    const { id } = req.params;
    // Pega os dados novos
    const { nome, agencia, conta, saldoInicial, dataSaldo, inativo } = req.body;

    try {
        const bancoAtualizado = await prisma.banco.update({
            where: { id: id },
            data: {
                nome,
                agencia,
                conta,
                saldoInicial: parseFloat(saldoInicial || 0),
                dataSaldo: dataSaldo ? new Date(dataSaldo) : undefined,
                inativo: inativo === 'sim' // Converte texto para booleano
            }
        });
        return res.json(bancoAtualizado);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ erro: "Erro ao atualizar banco." });
    }
});

// 3. Deletar banco
app.delete('/bancos/:id', async (req, res) => {
    await prisma.banco.delete({ where: { id: req.params.id } });
    return res.status(200).send();
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});