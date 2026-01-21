// --- ARQUIVO GLOBAL: script.js ---

document.addEventListener("DOMContentLoaded", () => {
    // 1. Gera o Menu automaticamente
    gerarMenuLateral();
    
    // 2. Destaca a página atual
    highlightActiveLink();
});

function gerarMenuLateral() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return; // Se não tiver sidebar na página, ignora

    // Aqui está o seu MENU CENTRALIZADO. Mudou aqui, muda no site todo!
    sidebar.innerHTML = `
        <div class="sidebar-header">
            <a href="#" onclick="toggleMenu()" style="color: #e53e3e; font-size: 14px; text-decoration: none;">
                <i class="fas fa-times"></i> Fechar
            </a>
        </div>

        <a href="index.html" class="menu-item">
            <div class="menu-content"><i class="fas fa-chart-pie"></i> Painel</div>
        </a>

        <div class="menu-item" onclick="toggleSubmenu(this)">
            <div class="menu-content"><i class="fas fa-cog"></i> Cadastros</div>
            <i class="fas fa-chevron-down arrow"></i>
        </div>
        <div class="submenu">
            <a href="bancos.html">Meus Bancos</a>
        </div>

        <div class="menu-item" onclick="toggleSubmenu(this)">
            <div class="menu-content"><i class="fas fa-wallet"></i> Financeiro</div>
            <i class="fas fa-chevron-down arrow"></i>
        </div>
        <div class="submenu">
            <a href="receber.html">Contas a Receber</a>
            <a href="pagar.html">Contas a Pagar</a>
            <a href="movimento.html">Extrato / Movimento</a>
            <a href="conciliacao.html">Conciliação</a>
        </div>

        <div class="menu-item" onclick="toggleSubmenu(this)">
            <div class="menu-content"><i class="fas fa-calendar-check"></i> Rotina</div>
            <i class="fas fa-chevron-down arrow"></i>
        </div>
        <div class="submenu">
            <a href="#" onclick="alert('Página Agenda em construção!')">Agenda</a>
            <a href="#" onclick="alert('Página Atividades em construção!')">Atividades</a>
        </div>

        <a href="#" onclick="sair()" class="menu-item menu-sair">
            <div class="menu-content"><i class="fas fa-sign-out-alt"></i> Sair do Sistema</div>
        </a>
    `;
}

// Lógica de Abrir/Fechar Menu Mobile
function toggleMenu() { 
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.overlay');
    
    if(sidebar) sidebar.classList.toggle('aberto'); 
    if(overlay) overlay.classList.toggle('ativo');
}

// Lógica dos Submenus (Accordions)
function toggleSubmenu(element) {
    const submenu = element.nextElementSibling;
    element.classList.toggle('open');
    
    if (submenu.style.maxHeight) {
        submenu.style.maxHeight = null;
    } else {
        submenu.style.maxHeight = submenu.scrollHeight + "px";
    }
}

// Função que pinta o link ativo (Agora separada para organizar)
function highlightActiveLink() {
    const path = window.location.pathname.split("/").pop() || 'index.html';
    
    // Procura o link dentro da sidebar que acabamos de criar
    const activeLink = document.querySelector(`.sidebar a[href="${path}"]`);
    
    if (activeLink) {
        if (activeLink.parentElement.classList.contains('submenu')) {
            // É filho (Submenu)
            activeLink.classList.add('active-link');
            const parentMenu = activeLink.parentElement.previousElementSibling;
            if(parentMenu) {
                parentMenu.classList.add('active', 'open');
                activeLink.parentElement.style.maxHeight = "100%";
            }
        } else {
            // É pai (Link direto)
            activeLink.classList.add('active');
        }
    }
}

// Formatador Global
function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}