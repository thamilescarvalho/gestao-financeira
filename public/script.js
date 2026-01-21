// --- ARQUIVO GLOBAL: script.js ---
// Tudo que for comum a todas as telas fica aqui!

// 1. Lógica do Menu Lateral (Abrir/Fechar)
function toggleMenu() { 
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.overlay');
    
    if(sidebar) sidebar.classList.toggle('aberto'); 
    if(overlay) overlay.classList.toggle('ativo');
}

// 2. Lógica dos Submenus (Cadastros, Financeiro)
function toggleSubmenu(element) {
    const submenu = element.nextElementSibling; // Pega a div .submenu logo depois
    element.classList.toggle('open'); // Gira a setinha
    
    if (submenu.style.maxHeight) {
        submenu.style.maxHeight = null; // Fecha
    } else {
        submenu.style.maxHeight = submenu.scrollHeight + "px"; // Abre
    }
}

// 3. Auto-Highlight (Pinta o menu da página atual)
document.addEventListener("DOMContentLoaded", () => {
    // Pega o nome do arquivo atual (ex: 'pagar.html')
    const path = window.location.pathname.split("/").pop() || 'index.html';
    
    // Procura o link no menu que tem esse href
    const activeLink = document.querySelector(`.sidebar a[href="${path}"]`);
    
    if (activeLink) {
        // Se for um link de submenu (filho)
        if (activeLink.parentElement.classList.contains('submenu')) {
            activeLink.classList.add('active-link'); // Pinta o filho
            
            // Abre o pai automaticamente
            const parentMenu = activeLink.parentElement.previousElementSibling;
            if(parentMenu) {
                parentMenu.classList.add('active', 'open'); // Pinta o pai
                activeLink.parentElement.style.maxHeight = "100%"; // Mantém aberto
            }
        } else {
            // Se for link direto (ex: Painel)
            activeLink.classList.add('active');
        }
    }
});

// 4. Função Global de Formatar Moeda (Para não repetir Intl em todo lugar)
function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}