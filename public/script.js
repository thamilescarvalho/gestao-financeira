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

    // Configura o sidebar como Flexbox
    sidebar.style.display = 'flex';
    sidebar.style.flexDirection = 'column';
    sidebar.style.height = '100vh'; 
    sidebar.style.overflow = 'hidden'; 

    // Lê o usuário do localStorage (agora com avatar do banco)
    const usuario = JSON.parse(localStorage.getItem('usuario_logado')) || { id: '0', nome: 'Visitante', email: 'admin' };
    const primeiroNome = usuario.nome.split(' ')[0]; 
    const iniciais = usuario.nome.substring(0, 2).toUpperCase();

    // --- NOVA LÓGICA SIMPLIFICADA ---
    // Não precisa mais ler 'perfil_extra'. O avatar vem direto do usuario.
    const clickAction = `onclick="window.location.href='perfil.html'" style="cursor: pointer;" title="Editar Perfil"`;

    let avatarHtml;
    if (usuario.avatar) {
        avatarHtml = `<img src="${usuario.avatar}" class="header-avatar-img" alt="Perfil" ${clickAction}>`;
    } else {
        avatarHtml = `<div class="header-avatar-img display-initials" ${clickAction}>${iniciais}</div>`;
    }

    // --- CSS INJETADO (MANTIDO IGUAL) ---
    const styleMenu = `
        <style>
            /* 1. Cabeçalho Ajustado */
            .sidebar-header {
                padding: 20px 20px 10px 20px !important;
                margin-bottom: 10px !important;
                flex-shrink: 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .header-user-group {
                display: flex;
                align-items: center;
                gap: 12px;
            }

            /* Estilo da Foto no Topo */
            .header-avatar-img {
                width: 42px; 
                height: 42px; 
                border-radius: 50%;
                border: 2px solid #a855f7;
                object-fit: cover;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(255,255,255,0.1);
                color: #fff;
                font-weight: 800;
                font-size: 14px;
                box-shadow: 0 0 10px rgba(168, 85, 247, 0.4);
                transition: transform 0.2s, box-shadow 0.2s;
            }
            
            .header-avatar-img:hover {
                transform: scale(1.1);
                box-shadow: 0 0 15px rgba(168, 85, 247, 0.8);
                border-color: #fff;
            }

            .display-initials {
                background: linear-gradient(135deg, #a855f7, #6366f1);
            }

            .header-user-name {
                font-size: 16px !important; 
                font-weight: 800 !important;
                color: white;
                letter-spacing: 0.5px;
                text-shadow: 0 0 5px rgba(0,0,0,0.5);
            }

            /* 2. Área do Menu */
            .sidebar-menu {
                flex: 1;
                overflow-y: auto !important;
                overflow-x: hidden;
                padding-bottom: 20px;
                scrollbar-width: thin;
                scrollbar-color: #334155 #1e293b;
            }
            .sidebar-menu::-webkit-scrollbar { width: 4px; }
            .sidebar-menu::-webkit-scrollbar-track { background: #1e293b; }
            .sidebar-menu::-webkit-scrollbar-thumb { background-color: #334155; border-radius: 4px; }

            /* 3. Itens do Menu */
            .sidebar-menu .menu-item { 
                font-size: 11px !important; 
                padding: 10px 20px !important; 
                font-weight: 700 !important;
                letter-spacing: 0.5px;
            }
            .sidebar-menu .menu-content i { 
                font-size: 13px !important; 
                width: 20px; 
                text-align: center; 
                margin-right: 8px;
            }

            /* Submenus */
            .sidebar-menu .submenu a { 
                font-size: 10px !important; 
                padding: 8px 20px 8px 50px !important; 
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

            /* 4. Rodapé Compacto */
            .user-profile {
                flex-shrink: 0;
                border-top: 1px solid rgba(255,255,255,0.1);
                padding: 15px 20px !important;
                margin-top: 0 !important;
                display: flex; 
                justify-content: space-between;
                align-items: center; 
                background: rgba(0,0,0,0.2);
            }
            
            .user-info-footer {
                display: flex;
                flex-direction: column;
            }
            
            .btn-logout-icon {
                color: #ef4444;
                cursor: pointer;
                font-size: 16px;
                padding: 5px;
                transition: 0.2s;
            }
            .btn-logout-icon:hover { transform: scale(1.2); text-shadow: 0 0 10px red; }
        </style>
    `;

    sidebar.innerHTML = styleMenu + `
        <div class="sidebar-header">
            <div class="header-user-group">
                ${avatarHtml} <div class="header-user-name">${primeiroNome}!</div>
            </div>
            <button class="btn-close-sidebar" onclick="toggleMenu()" title="Fechar Menu" style="background:none; border:none; color:white; font-size:18px; cursor:pointer;">
                <i class="fas fa-times"></i>
            </button>
        </div>

        <div class="sidebar-menu">
            <a href="index.html" class="menu-item link-navegacao">
                <div class="menu-content"><i class="fas fa-chart-pie"></i> Painel</div>
            </a>

            <a href="feed-pv.html" class="menu-item link-navegacao">
            <div class="menu-content"><i class="fas fa-stream"></i> Meu Feed (Em teste)</div>
            </a>

            <div class="menu-item" onclick="toggleSubmenu(this)">
                <div class="menu-content"><i class="fas fa-database"></i> Cadastros</div>
                <i class="fas fa-chevron-down arrow"></i>
            </div>

            <div class="submenu">
                <a href="perfil.html" class="link-navegacao">Meu Perfil</a>
                <a href="usuarios.html" class="link-navegacao">Usuário</a>
            </div>

            <div class="menu-item" onclick="toggleSubmenu(this)">
                <div class="menu-content"><i class="fas fa-wallet"></i> Financeiro</div>
                <i class="fas fa-chevron-down arrow"></i>
            </div>
            <div class="submenu">
                <a href="bancos.html" class="link-navegacao">Meus Bancos</a>
                <a href="receber.html" class="link-navegacao">Contas a Receber</a>
                <a href="pagar.html" class="link-navegacao">Contas a Pagar</a>
                <a href="movimento.html" class="link-navegacao">Extrato / Movimentação</a> 
                <a href="conciliacao.html" class="link-navegacao">Conciliação (OFX)</a>
                <a href="cartoes.html" class="link-navegacao">Meus Cartões</a>
                <a href="relatorios.html" class="link-navegacao">Relatórios</a> 
            </div>
            
            <div class="menu-item" onclick="toggleSubmenu(this)">
                <div class="menu-content"><i class="fas fa-calendar-alt"></i> Agenda</div>
                <i class="fas fa-chevron-down arrow"></i>
            </div>
            <div class="submenu">
                <a href="agenda.html" class="link-navegacao">Calendário</a>
                 <a href="projetos.html" class="link-navegacao">Projetos (Em teste)</a>
            </div>
        </div>

        <div class="user-profile">
            <div class="user-info-footer">
                <div style="font-size: 9px; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Usuário:</div>
                <div style="color: white; font-size: 11px; font-weight: 600;">${usuario.email}</div>
            </div>
            <div class="btn-logout-icon" onclick="sair()" title="Sair do Sistema"><i class="fas fa-sign-out-alt"></i></div>
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