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
// ROTA UNIFICADA DE CRIAR TRANSAÇÃO (COM PARCELAMENTO AUTOMÁTICO)
// ==========================================
app.post('/transacoes', async (req, res) => {
    try {
        const { descricao, valor, tipo, categoria, status, data, dataPagamento, bancoId, usuarioId, fornecedor, formaPagamento, parcelas } = req.body;

        if (!usuarioId) return res.status(400).json({ erro: "ID do usuário é obrigatório." });

        // Tratamento de Data Inicial
        let dataBase = new Date();
        if (data) {
            const dataString = data.includes('T') ? data : `${data}T12:00:00`;
            dataBase = new Date(dataString);
        }
        if (isNaN(dataBase.getTime())) dataBase = new Date();

        // Tratamento de Data de Pagamento (se houver)
        let dataPagtoBase = null;
        if (dataPagamento) {
            const dataPagtoString = dataPagamento.includes('T') ? dataPagamento : `${dataPagamento}T12:00:00`;
            const testeData = new Date(dataPagtoString);
            if (!isNaN(testeData.getTime())) dataPagtoBase = testeData;
        }

        // Verifica quantas parcelas são (Se não vier nada, assume 1)
        const qtdParcelas = parseInt(parcelas) || 1;
        const valorParcela = parseFloat(valor); // O valor digitado é o valor DA PARCELA

        // Array para armazenar as operações no banco
        const transacoesCriadas = [];

        // --- LOOP DE CRIAÇÃO DAS PARCELAS ---
        for (let i = 0; i < qtdParcelas; i++) {
            
            // 1. Calcula a data desta parcela (Soma meses)
            const dataDestaParcela = new Date(dataBase);
            dataDestaParcela.setMonth(dataDestaParcela.getMonth() + i);

            // Se tiver data de pagamento (já foi pago), ajusta também, senão deixa null para as futuras
            let dataPagtoDesta = null;
            let statusDesta = status;

            // Lógica: Se for a primeira e já estiver marcada como PAGO, mantém. 
            // As próximas (futuras) nascem como PENDENTE, a não ser que você queira lançar tudo pago.
            // Aqui assumirei: Se parcelou, as próximas são projeção (Pendente).
            if (i > 0) {
                statusDesta = 'PENDENTE'; 
                dataPagtoDesta = null;
            } else {
                // A primeira parcela segue o que veio da tela
                dataPagtoDesta = dataPagtoBase;
            }

            // 2. Ajusta a descrição (Ex: "Compra (1/5)")
            let descricaoFinal = descricao;
            if (qtdParcelas > 1) {
                descricaoFinal = `${descricao} (${i + 1}/${qtdParcelas})`;
            }

            // 3. Prepara a criação
            const novaTransacao = await prisma.transacao.create({
                data: {
                    fornecedor: fornecedor || descricao, 
                    descricao: descricaoFinal,
                    formaPagamento: formaPagamento || "Outros", 
                    valor: valorParcela,
                    tipo,
                    categoria: categoria || 'Geral',
                    status: statusDesta,
                    data: dataDestaParcela, // Data vencimento/competência
                    dataPagamento: dataPagtoDesta,
                    banco: (bancoId && bancoId !== "") ? { connect: { id: bancoId } } : undefined,
                    usuario: { connect: { id: usuarioId } }
                }
            });
            transacoesCriadas.push(novaTransacao);
        }

        // --- AUTOMAGIA DO CASHBACK INFINITY (Apenas 1 vez sobre o total) ---
        // Se for compra parcelada no crédito, o cashback geralmente vem sobre o TOTAL, de uma vez só.
        if (
            tipo === 'DESPESA' && 
            (formaPagamento === 'Cartão' || formaPagamento === 'Crédito') && 
            categoria !== 'Importação OFX'
        ) {
            // Calcula o valor TOTAL da compra para aplicar 1.5%
            const valorTotalCompra = valorParcela * qtdParcelas;
            const valorCashback = valorTotalCompra * 0.015;

            await prisma.transacao.create({
                data: {
                    fornecedor: 'InfinityPay',
                    descricao: `Cashback - ${descricao}`,
                    valor: valorCashback,
                    tipo: 'RECEITA',
                    categoria: 'Cashback',
                    status: 'RECEBIDO',
                    formaPagamento: 'Automático',
                    data: dataBase, // Data da compra (hoje)
                    dataPagamento: dataBase,
                    banco: (bancoId && bancoId !== "") ? { connect: { id: bancoId } } : undefined,
                    usuario: { connect: { id: usuarioId } }
                }
            });
        }

        // Retorna a primeira parcela criada só para o front não dar erro
        res.json(transacoesCriadas[0]);

    } catch (e) {
        console.error("ERRO GRAVE AO SALVAR TRANSAÇÃO:", e);
        res.status(500).json({ erro: "Erro ao salvar no banco de dados.", detalhe: e.message });
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
// ROTA DE RELATÓRIOS AVANÇADOS (DARK MODE READY)
// ==========================================
app.get('/relatorios/avancado', async (req, res) => {
    const { usuarioId, inicio, fim, bancoId } = req.query; // Adicionado bancoId
    if (!usuarioId) return res.json({});

    try {
        const hoje = new Date();
        const dataInicio = inicio ? new Date(inicio + "T00:00:00") : new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        const dataFim = fim ? new Date(fim + "T23:59:59") : new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);

        // Filtro Base
        const filtroComum = {
            usuarioId,
            status: { in: ['PAGO', 'RECEBIDO'] }, // Considera tudo que foi realizado
            tipo: 'DESPESA',
            dataPagamento: { gte: dataInicio, lte: dataFim }
        };

        // Se o usuário selecionou um banco específico no filtro
        if (bancoId) {
            filtroComum.bancoId = bancoId;
        }

        // 1. FORMAS DE PAGAMENTO
        const porForma = await prisma.transacao.groupBy({
            by: ['formaPagamento'],
            _sum: { valor: true },
            where: filtroComum
        });

        // 2. TOP FORNECEDORES
        const porFornecedor = await prisma.transacao.groupBy({
            by: ['fornecedor'],
            _sum: { valor: true },
            where: filtroComum,
            orderBy: { _sum: { valor: 'desc' } },
            take: 5
        });

        // 3. DETALHAMENTO DE CARTÕES (Agrupado por BANCO)
        // Isso resolve o problema de "vários cartões". Cada banco é um cartão.
        const gastosPorCartao = await prisma.transacao.groupBy({
            by: ['bancoId'],
            _sum: { valor: true },
            where: {
                ...filtroComum,
                formaPagamento: { in: ['Cartão', 'Crédito', 'Credit Card'] }
            }
        });

        // Enriquece com o nome do banco
        const cartoesDetalhados = [];
        for (const item of gastosPorCartao) {
            if(item.bancoId) {
                const b = await prisma.banco.findUnique({ where: { id: item.bancoId } });
                cartoesDetalhados.push({ nome: b.nome, total: item._sum.valor });
            }
        }

        // Totais gerais de Cartão
        const totalCartao = cartoesDetalhados.reduce((acc, c) => acc + c.total, 0);

        // 4. TOTAL GERAL
        const totalGeral = await prisma.transacao.aggregate({
            _sum: { valor: true },
            where: filtroComum
        });

        res.json({
            porForma,
            porFornecedor,
            cartao: {
                total: totalCartao,
                lista: cartoesDetalhados // Envia a lista separada por banco
            },
            totalGeral: totalGeral._sum.valor || 0
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "Erro nos relatórios" });
    }
});

// ==========================================
// ROTA DE ANÁLISE DE CARTÕES (COM FILTROS)
// ==========================================
app.get('/relatorios/cartoes-detalhado', async (req, res) => {
    const { usuarioId, bancoId, inicio, fim } = req.query;
    if (!usuarioId) return res.json({});

    try {
        // Filtro Base (Despesa + Cartão)
        const filtroBase = {
            usuarioId,
            tipo: 'DESPESA',
            formaPagamento: { in: ['Cartão', 'Crédito', 'Credit Card'] }
        };

        // Se escolheu um cartão específico, filtra tudo por ele
        if (bancoId) {
            filtroBase.bancoId = bancoId;
        }

        // 1. HISTÓRICO (O QUE JÁ PAGUEI) - Respeita o filtro de data
        const filtroHistorico = { ...filtroBase, status: 'PAGO' };
        
        if (inicio && fim) {
            filtroHistorico.dataPagamento = { 
                gte: new Date(inicio + "T00:00:00"), 
                lte: new Date(fim + "T23:59:59") 
            };
        }

        const historicoPorBanco = await prisma.transacao.groupBy({
            by: ['bancoId'],
            _sum: { valor: true },
            where: filtroHistorico
        });

        const listaBancos = [];
        for (const item of historicoPorBanco) {
            if(item.bancoId) {
                const b = await prisma.banco.findUnique({ where: { id: item.bancoId } });
                listaBancos.push({ nome: b.nome, total: item._sum.valor });
            }
        }

        // 2. PROJEÇÃO (O QUE VOU PAGAR) - Mostra do dia atual para frente
        // (Ou respeita filtro se quiser ver o futuro específico, mas geralmente é "daqui pra frente")
        const filtroFuturo = {
            ...filtroBase,
            status: 'PENDENTE',
            dataPagamento: { gte: new Date() } // Sempre de hoje em diante
        };

        const pendentes = await prisma.transacao.findMany({
            where: filtroFuturo,
            orderBy: { dataPagamento: 'asc' }
        });

        // Agrupa por Mês (Ex: "02/2026")
        const projecaoMap = {};
        pendentes.forEach(t => {
            if(t.dataPagamento) {
                // Ajuste de fuso simples para pegar o mês correto
                const dataObj = new Date(t.dataPagamento);
                const mes = (dataObj.getMonth() + 1).toString().padStart(2, '0');
                const ano = dataObj.getFullYear();
                const chave = `${mes}/${ano}`;
                
                if(!projecaoMap[chave]) projecaoMap[chave] = 0;
                projecaoMap[chave] += t.valor;
            }
        });

        // Transforma em lista ordenada
        const projecao = Object.entries(projecaoMap)
            .map(([mes, valor]) => ({ mes, valor }))
            // Ordenação simples por ano/mês (string MM/YYYY não ordena bem direto, mas serve para poucos meses)
            // Ideal: ordenar pela data real, mas aqui vamos confiar na ordem do banco
            .slice(0, 12); // Mostra os próximos 12 meses

        res.json({
            pagoPorBanco: listaBancos,
            projecao: projecao,
            totalPagoGeral: listaBancos.reduce((acc, i) => acc + i.total, 0),
            totalFuturoGeral: pendentes.reduce((acc, i) => acc + i.valor, 0)
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "Erro ao analisar cartões" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); });