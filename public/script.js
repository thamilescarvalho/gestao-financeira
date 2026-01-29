// --- ARQUIVO GLOBAL: script.js ---

document.addEventListener("DOMContentLoaded", () => {
    gerarMenuLateral();
    highlightActiveLink();
    garantirOverlay();
});

function garantirOverlay() {
    let overlay = document.querySelector('.overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'overlay';
        document.body.appendChild(overlay);
    }
    overlay.onclick = toggleMenu;
}

function gerarMenuLateral() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    // Configura o sidebar como Flexbox para gerenciar o espaço vertical
    sidebar.style.display = 'flex';
    sidebar.style.flexDirection = 'column';
    sidebar.style.height = '100vh'; /* Garante altura total */
    sidebar.style.overflow = 'hidden'; /* Evita barra de rolagem dupla */

    const usuario = JSON.parse(localStorage.getItem('usuario_logado')) || { nome: 'Visitante', email: 'admin' };
    const primeiroNome = usuario.nome.split(' ')[0]; 
    const iniciais = usuario.nome.substring(0, 2).toUpperCase();

    // --- CSS INJETADO PARA OTIMIZAR ESPAÇO VERTICAL ---
    const styleMenu = `
        <style>
            /* 1. Cabeçalho Compacto */
            .sidebar-header {
                padding: 15px 20px 5px 20px !important; /* Reduzi o padding inferior */
                margin-bottom: 10px !important;
                flex-shrink: 0; /* Não deixa o cabeçalho encolher */
            }
            
            /* Remove a etiqueta "MENU" para ganhar espaço */
            .header-badge { display: none !important; } 

            /* 2. Área do Menu com Rolagem Automática */
            .sidebar-menu {
                flex: 1; /* Ocupa todo o espaço disponível */
                overflow-y: auto !important; /* Cria rolagem se não couber */
                overflow-x: hidden;
                padding-bottom: 20px;
                
                /* Estilo da barra de rolagem fina */
                scrollbar-width: thin;
                scrollbar-color: #334155 #1e293b;
            }
            
            /* Webkit Scrollbar (Chrome/Edge) */
            .sidebar-menu::-webkit-scrollbar { width: 4px; }
            .sidebar-menu::-webkit-scrollbar-track { background: #1e293b; }
            .sidebar-menu::-webkit-scrollbar-thumb { background-color: #334155; border-radius: 4px; }

            /* 3. Itens Mais Compactos */
            .sidebar-menu .menu-item { 
                font-size: 11px !important; 
                padding: 10px 20px !important; /* Menos altura */
                font-weight: 700 !important;
                letter-spacing: 0.5px;
            }
            
            .sidebar-menu .menu-content i { 
                font-size: 13px !important; 
                width: 20px; 
                text-align: center; 
                margin-right: 8px;
            }

            /* Submenus Compactos */
            .sidebar-menu .submenu a { 
                font-size: 10px !important; 
                padding: 8px 20px 8px 50px !important; /* Mais apertadinho */
                font-weight: 600 !important;
                letter-spacing: 0.3px;
                color: #94a3b8 !important;
            }
            .sidebar-menu .submenu a:hover, .sidebar-menu .submenu a.active-link {
                color: #fff !important;
            }
            
            .submenu { 
                overflow: hidden !important; 
                transition: max-height 0.3s ease-out; 
            }

            /* 4. Rodapé do Usuário Fixo no Fundo */
            .user-profile {
                flex-shrink: 0; /* Não encolhe */
                border-top: 1px solid #334155;
                padding: 15px 20px !important;
                margin-top: 0 !important;
            }
        </style>
    `;

    sidebar.innerHTML = styleMenu + `
        <div class="sidebar-header">
            <div class="header-info">
                <div class="header-user-name" style="font-size: 14px;">Olá, ${primeiroNome}</div>
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
                <a href="usuarios.html" class="link-navegacao">Usuários</a> 
            </div>

            <div class="menu-item" onclick="toggleSubmenu(this)">
                <div class="menu-content"><i class="fas fa-wallet"></i> Financeiro</div>
                <i class="fas fa-chevron-down arrow"></i>
            </div>
            <div class="submenu">
                <a href="receber.html" class="link-navegacao">Contas a Receber</a>
                <a href="pagar.html" class="link-navegacao">Contas a Pagar</a>
                <a href="cartoes.html" class="link-navegacao">Meus Cartões</a> 
                <a href="movimento.html" class="link-navegacao">Extrato / Movimento</a>
                <a href="conciliacao.html" class="link-navegacao">Conciliação</a>
                <a href="bancos.html" class="link-navegacao">Meus Bancos</a>
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
                <div class="user-name" style="font-size: 9px; color: #94a3b8; font-weight: 700;">LOGADO COMO</div>
                <div class="user-role" style="color: white; font-size: 10px;">${usuario.email}</div>
            </div>
            <div class="btn-logout-icon" onclick="sair()" title="Sair"><i class="fas fa-sign-out-alt"></i></div>
        </div>
    `;

    document.querySelectorAll('.link-navegacao').forEach(link => {
        link.addEventListener('click', () => { 
            if (window.innerWidth <= 768) toggleMenu(); 
        });
    });
}

function toggleMenu() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.overlay');
    if (sidebar) sidebar.classList.toggle('aberto');
    if (overlay) overlay.classList.toggle('ativo'); 
}

function toggleSubmenu(element) {
    const submenu = element.nextElementSibling;
    element.classList.toggle('open'); 
    
    // Cálculo exato da altura
    if (submenu.style.maxHeight) { 
        submenu.style.maxHeight = null; 
    } else { 
        submenu.style.maxHeight = submenu.scrollHeight + "px"; 
    }
}

function highlightActiveLink() {
    const path = window.location.pathname.split("/").pop() || 'index.html';
    const activeLink = document.querySelector(`.sidebar a[href="${path}"]`);
    
    if (activeLink) {
        if (activeLink.parentElement.classList.contains('submenu')) {
            activeLink.classList.add('active-link');
            const parentMenu = activeLink.parentElement.previousElementSibling;
            if(parentMenu) {
                parentMenu.classList.add('active', 'open');
                // Timeout para garantir que o DOM renderizou
                setTimeout(() => {
                    activeLink.parentElement.style.maxHeight = activeLink.parentElement.scrollHeight + "px";
                }, 50);
            }
        } else { 
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
function logout() {
    Swal.fire({
        title: 'Sair do Sistema?',
        text: "Você terá que fazer login novamente.",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#1e293b',
        confirmButtonText: 'Sim, sair',
        cancelButtonText: 'Cancelar'
    }).then((result) => {
        if (result.isConfirmed) {
            // Limpa os dados do usuário
            localStorage.removeItem('usuario_logado');
            localStorage.removeItem('token'); // Se estiver usando token
            
            // Redireciona para a tela de login
            window.location.href = 'index.html'; // Ou login.html, dependendo do seu arquivo principal
        }
    });
}