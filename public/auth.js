// public/auth.js

// 1. Verifica se o usuário tem permissão para estar aqui
// (Roda automaticamente assim que a página abre)
function verificarLogin() {
    const usuarioLogado = localStorage.getItem('usuario_logado');
    const paginaAtual = window.location.pathname;

    // Se NÃO tem usuário logado E NÃO está na tela de login...
    if (!usuarioLogado && !paginaAtual.includes('login.html')) {
        // ...chuta para fora!
        window.location.href = 'login.html';
    }
}

// 2. Função de SAIR (Logout)
function sair() {
    if(confirm("Tem certeza que deseja sair do sistema?")) {
        // Remove o "crachá" de acesso
        localStorage.removeItem('usuario_logado');
        // Redireciona para o login
        window.location.href = 'login.html';
    }
}

// Executa a verificação imediatamente
verificarLogin();