// --- ARQUIVO GLOBAL: script.js ---

document.addEventListener("DOMContentLoaded", () => {
    // 1. Gera o Menu
    gerarMenuLateral();
    
    // 2. Destaca a página atual
    highlightActiveLink();

    // 3. Garante que o Overlay (sombra) exista e funcione
    garantirOverlay();
});

function garantirOverlay() {
    let overlay = document.querySelector('.overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'overlay';
        document.body.appendChild(overlay);
    }
    // Garante o evento de clique para fechar
    overlay.onclick = toggleMenu;
}

function gerarMenuLateral() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    const usuario = JSON.parse(localStorage.getItem('usuario_logado')) || { nome: 'Visitante', email: 'admin' };
    const primeiroNome = usuario.nome.split(' ')[0]; 
    const iniciais = usuario.nome.substring(0, 2).toUpperCase();

    sidebar.innerHTML = `
        <div class="sidebar-header">
            <div class="header-info">
                <div class="header-user-name">Olá, ${primeiroNome}</div>
                <div class="header-badge">Menu</div>
            </div>
            <button class="btn-close-sidebar" onclick="toggleMenu()" title="Fechar Menu">
                <i class="fas fa-times"></i>
            </button>
        </div>

        <div class="sidebar-menu">
            
            <a href="index.html" class="menu-item link-navegacao">
                <div class="menu-content"><i class="fas fa-chart-pie"></i> Painel</div>
            </a>

            <div class="menu-item" onclick="toggleSubmenu(this)">
                <div class="menu-content"><i class="fas fa-database"></i> Cadastros</div>
                <i class="fas fa-chevron-down arrow"></i>
            </div>
            <div class="submenu">
                <a href="bancos.html" class="link-navegacao">Meus Bancos</a>
                <a href="usuarios.html" class="link-navegacao">Usuários</a> 
            </div>

            <div class="menu-item" onclick="toggleSubmenu(this)">
                <div class="menu-content"><i class="fas fa-wallet"></i> Financeiro</div>
                <i class="fas fa-chevron-down arrow"></i>
            </div>
            <div class="submenu">
                <a href="receber.html" class="link-navegacao">Contas a Receber</a>
                <a href="pagar.html" class="link-navegacao">Contas a Pagar</a>
                <a href="movimento.html" class="link-navegacao">Extrato / Movimento</a>
                <a href="conciliacao.html" class="link-navegacao">Conciliação</a>
                <a href="relatorios.html" class="link-navegacao">Relatórios</a> 
            </div>
            
            <div class="menu-item" onclick="toggleSubmenu(this)">
                <div class="menu-content"><i class="fas fa-calendar-alt"></i> Agenda</div>
                <i class="fas fa-chevron-down arrow"></i>
            </div>
            <div class="submenu">
                <a href="agenda.html" class="link-navegacao">Calendário</a>
                <a href="rotinas.html" class="link-navegacao">Tarefas</a>
            </div>

        </div>

        <div class="user-profile">
            <div class="user-avatar">${iniciais}</div>
            <div class="user-info">
                <div class="user-name" style="font-size: 12px; color: #94a3b8;">Logado como</div>
                <div class="user-role" style="color: white;">${usuario.email}</div>
            </div>
            <div class="btn-logout-icon" onclick="sair()" title="Sair"><i class="fas fa-sign-out-alt"></i></div>
        </div>
    `;

    // Garante que links de navegação também fechem o menu (mobile)
    document.querySelectorAll('.link-navegacao').forEach(link => {
        link.addEventListener('click', () => { 
            // Só fecha se estiver em tela pequena
            if (window.innerWidth <= 768) toggleMenu(); 
        });
    });
}

// --- LÓGICA DE ABRIR/FECHAR ---
function toggleMenu() {
    const sidebar = document.querySelector('.sidebar'); // ou getElementById('sidebar')
    const overlay = document.querySelector('.overlay');
    
    if (sidebar) sidebar.classList.toggle('aberto'); // CSS deve ter .sidebar.aberto
    if (overlay) overlay.classList.toggle('ativo');  // CSS deve ter .overlay.ativo
}

function toggleSubmenu(element) {
    const submenu = element.nextElementSibling;
    element.classList.toggle('open'); // Gira seta
    
    if (submenu.style.maxHeight) { 
        submenu.style.maxHeight = null; 
    } else { 
        submenu.style.maxHeight = submenu.scrollHeight + "px"; 
    }
}

function highlightActiveLink() {
    // Pega o nome do arquivo da URL (ex: "agenda.html")
    const path = window.location.pathname.split("/").pop() || 'index.html';
    
    // Procura o link correspondente
    const activeLink = document.querySelector(`.sidebar a[href="${path}"]`);
    
    if (activeLink) {
        // Se for um link de submenu
        if (activeLink.parentElement.classList.contains('submenu')) {
            activeLink.classList.add('active-link');
            
            // Abre o menu pai
            const parentMenu = activeLink.parentElement.previousElementSibling;
            if(parentMenu) {
                parentMenu.classList.add('active', 'open'); // Destaca pai e gira seta
                activeLink.parentElement.style.maxHeight = "500px"; // Força abertura
            }
        } else { 
            // Link direto (ex: Painel)
            activeLink.classList.add('active'); 
        }
    }
}

function formatarMoeda(valor) { 
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor); 
}

function sair() { 
    localStorage.removeItem('usuario_logado'); 
    window.location.href = 'login.html'; 
}