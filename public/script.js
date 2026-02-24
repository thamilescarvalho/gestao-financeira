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

    // Lê o usuário do localStorage
    const usuario = JSON.parse(localStorage.getItem('usuario_logado')) || { id: '0', nome: 'Visitante', email: 'admin', role: 'USER' };
    const primeiroNome = usuario.nome.split(' ')[0]; 
    const iniciais = usuario.nome.substring(0, 2).toUpperCase();

    // Ação ao clicar no avatar
    const clickAction = `onclick="window.location.href='perfil.html'" style="cursor: pointer;" title="Editar Perfil"`;

    let avatarHtml;
    if (usuario.avatar) {
        avatarHtml = `<img src="${usuario.avatar}" class="header-avatar-img" alt="Perfil" ${clickAction}>`;
    } else {
        avatarHtml = `<div class="header-avatar-img display-initials" ${clickAction}>${iniciais}</div>`;
    }

    // --- LÓGICA DE PERMISSÃO ---
    // Cria o link HTML apenas se for ADMIN, caso contrário fica vazio
    const menuUsuariosLink = (usuario.role === 'ADMIN') 
        ? `<a href="usuarios.html" class="link-navegacao">Usuários</a>` 
        : '';

    // --- CSS DO MENU ---
    const styleMenu = `
        <style>
            /* CONTAINER PRINCIPAL */
            .sidebar {
                position: fixed; left: -280px; top: 0; width: 280px; 
                height: 100vh; height: 100dvh; 
                background: rgba(30, 27, 46, 0.98); backdrop-filter: blur(25px);
                z-index: 2000; transition: 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 5px 0 30px rgba(0,0,0,0.7); 
                display: flex; flex-direction: column; 
                border-right: 1px solid rgba(168, 85, 247, 0.3);
                overflow: hidden; 
            }
            .sidebar.active { left: 0; }

            /* CABEÇALHO */
            .sidebar-header {
                padding: 20px 20px !important;
                flex-shrink: 0; height: 80px; 
                display: flex; justify-content: space-between; align-items: center;
                background: rgba(255,255,255,0.02);
                border-bottom: 1px solid rgba(255,255,255,0.05);
                box-sizing: border-box;
            }
            .header-user-group { display: flex; align-items: center; gap: 12px; }

            /* AVATAR */
            .header-avatar-img {
                width: 42px; height: 42px; border-radius: 50%;
                border: 2px solid #a855f7; object-fit: cover;
                display: flex; align-items: center; justify-content: center;
                background: rgba(255,255,255,0.1); color: #fff;
                font-weight: 800; font-size: 14px;
                box-shadow: 0 0 10px rgba(168, 85, 247, 0.4);
                transition: transform 0.2s;
            }
            .header-avatar-img:hover { transform: scale(1.1); box-shadow: 0 0 15px rgba(168, 85, 247, 0.8); border-color: #fff; }
            .display-initials { background: linear-gradient(135deg, #a855f7, #6366f1); }
            .header-user-name { font-size: 15px !important; font-weight: 800 !important; color: white; letter-spacing: 0.5px; text-transform: uppercase; }

            /* ÁREA DE SCROLL DO MENU */
            .sidebar-menu {
                flex-grow: 1; height: calc(100% - 140px); 
                overflow-y: auto !important; overflow-x: hidden;
                padding-bottom: 40px; padding-top: 10px;
                scrollbar-width: none; -ms-overflow-style: none; 
            }
            .sidebar-menu::-webkit-scrollbar { display: none; }

            /* ITENS DO MENU */
            .sidebar-menu .menu-item { 
                font-size: 12px !important; padding: 12px 20px !important; 
                font-weight: 700 !important; letter-spacing: 0.5px;
                color: rgba(255,255,255,0.7); cursor: pointer; transition: 0.2s;
                text-decoration: none; display: flex; align-items: center; justify-content: space-between;
            }
            .sidebar-menu .menu-item:hover { color: white; background: rgba(255,255,255,0.05); }
            .sidebar-menu .menu-content { display: flex; align-items: center; }
            .sidebar-menu .menu-content i { font-size: 14px !important; width: 25px; text-align: center; margin-right: 10px; color: #a855f7; }

            /* SETA DO SUBMENU */
            .arrow { transition: transform 0.3s; font-size: 10px; }
            .menu-item.open .arrow { transform: rotate(180deg); color: #d8b4fe; }

            /* SUBMENUS */
            .submenu { overflow: hidden !important; max-height: 0; transition: max-height 0.3s ease-out; background: rgba(0,0,0,0.2); }
            .submenu.open { max-height: 2000px; } 
            
            .sidebar-menu .submenu a { 
                font-size: 11px !important; padding: 12px 20px 12px 55px !important; 
                font-weight: 600 !important; letter-spacing: 0.3px; color: #94a3b8 !important;
                text-decoration: none; display: block; transition: 0.2s;
            }
            .sidebar-menu .submenu a:hover, .sidebar-menu .submenu a.active-link { color: #fff !important; background: rgba(168, 85, 247, 0.1); border-right: 3px solid #a855f7; }

            /* RODAPÉ */
            .user-profile {
                flex-shrink: 0; height: 60px; 
                border-top: 1px solid rgba(255,255,255,0.1);
                padding: 0 20px !important; display: flex; justify-content: space-between; 
                align-items: center; background: rgba(30, 27, 46, 1);
                z-index: 10; position: relative;
                box-shadow: 0 -5px 20px rgba(0,0,0,0.2);
                box-sizing: border-box;
            }
            .user-info-footer { display: flex; flex-direction: column; }
            .btn-logout-icon { color: #ef4444; cursor: pointer; font-size: 16px; padding: 5px; transition: 0.2s; }
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
                <div class="menu-content"><i class="fas fa-chart-pie"></i> PAINEL</div>
            </a>

            <div class="menu-item" onclick="toggleSubmenu(this)">
                <div class="menu-content"><i class="fas fa-database"></i> CADASTROS</div>
                <i class="fas fa-chevron-down arrow"></i>
            </div>
            <div class="submenu">
                <a href="perfil.html" class="link-navegacao">Meu Perfil</a>
                ${menuUsuariosLink} </div>

            <div class="menu-item" onclick="toggleSubmenu(this)">
                <div class="menu-content"><i class="fas fa-wallet"></i> FINANCEIRO</div>
                <i class="fas fa-chevron-down arrow"></i>
            </div>
            <div class="submenu">
                <a href="bancos.html" class="link-navegacao">Meus Bancos</a>
                <a href="cofrinhos.html" class="link-navegacao">Cofrinhos</a>
                <a href="receber.html" class="link-navegacao">Contas a Receber</a>
                <a href="pagar.html" class="link-navegacao">Contas a Pagar</a>
                <a href="movimento.html" class="link-navegacao">Extrato / Movimentação</a> 
                <a href="conciliacao.html" class="link-navegacao">Conciliação (OFX)</a>
                <a href="cartoes.html" class="link-navegacao">Meus Cartões</a>
                <a href="relatorios.html" class="link-navegacao">Relatórios</a> 
            </div>
            
            <div class="menu-item" onclick="toggleSubmenu(this)">
                <div class="menu-content"><i class="fas fa-calendar-alt"></i> AGENDA</div>
                <i class="fas fa-chevron-down arrow"></i>
            </div>
            <div class="submenu">
                <a href="agenda.html" class="link-navegacao">Calendário</a>
                <a href="projetos.html" class="link-navegacao">Projetos (Em teste)</a>
                <a href="feed-pv.html" class="link-navegacao" style="color: #d8b4fe !important;">Meu Feed (Em teste)</a>
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

    // Garante que links fechem o menu no mobile
    document.querySelectorAll('.link-navegacao').forEach(link => {
        link.addEventListener('click', () => { 
            if (window.innerWidth <= 768) toggleMenu(); 
        });
    });
}

function toggleMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.overlay');
    
    if (sidebar) sidebar.classList.toggle('active');
    if (overlay) overlay.classList.toggle('active'); 
}

// --- FUNÇÃO SANFONA (FECHA OUTROS) ---
function toggleSubmenu(element) {
    const submenu = element.nextElementSibling;
    
    // 1. Fecha TODOS os outros submenus abertos primeiro
    const allOpenMenus = document.querySelectorAll('.menu-item.open');
    allOpenMenus.forEach(item => {
        if (item !== element) { 
            item.classList.remove('open');
            const sub = item.nextElementSibling;
            if (sub) {
                sub.classList.remove('open');
                sub.style.maxHeight = null;
            }
        }
    });

    // 2. Alterna o estado do menu atual
    element.classList.toggle('open'); 
    submenu.classList.toggle('open');
    
    // 3. Define a altura para animação
    if (submenu.style.maxHeight) { 
        submenu.style.maxHeight = null; 
    } else { 
        submenu.style.maxHeight = "1500px"; 
    }
}

function highlightActiveLink() {
    const path = window.location.pathname.split("/").pop() || 'index.html';
    const activeLink = document.querySelector(`.sidebar a[href="${path}"]`);
    
    if (activeLink) {
        if (activeLink.parentElement.classList.contains('submenu')) {
            activeLink.classList.add('active-link');
            // Abre o menu pai automaticamente
            const parentMenu = activeLink.parentElement.previousElementSibling;
            const parentSubmenu = activeLink.parentElement;
            if(parentMenu) {
                parentMenu.classList.add('open');
                parentSubmenu.classList.add('open');
                parentSubmenu.style.maxHeight = "1500px";
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