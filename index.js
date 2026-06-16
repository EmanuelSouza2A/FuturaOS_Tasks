// URL oficial da sua API na Cloudflare Worker
const API_URL = "https://futuraos-apisouzacarisemanuelfelipe4workersdev.souzacarisemanuelfelipe4.workers.dev";

// Variáveis de controle do sistema
let idDoAparelho = "";
let intervaloChecagem = null;

// ========================================================
// 1. IDENTIFICAÇÃO DO APARELHO (PC ou Celular)
// ========================================================
function obterIdDispositivo() {
    let id = localStorage.getItem("futuraos_device_id");
    
    if (!id) {
        // Puxa dados do aparelho para gerar uma assinatura única
        const dadosAparelho = navigator.userAgent + screen.width + screen.height + navigator.language;
        id = "FUTURAOS_" + btoa(dadosAparelho).slice(0, 12);
        localStorage.setItem("futuraos_device_id", id);
    }
    
    return id;
}

// ========================================================
// 2. CONTROLE DO BOTÃO PREMIUM (Interface Visual)
// ========================================================
function atualizarBotaoPremiumUI(status) {
    const botaoPremium = document.getElementById("btn-premium");
    
    if (!botaoPremium) return; 

    if (status === "liberado") {
        botaoPremium.disabled = false;
        botaoPremium.innerHTML = "⭐ Entrar no Painel Premium (VIP Ativo)";
        botaoPremium.style.backgroundColor = "#28a745"; // Verde sucesso
        botaoPremium.style.cursor = "pointer";
    } else {
        botaoPremium.disabled = true; // Deixa o botão trancado
        botaoPremium.innerHTML = "🔒 Premium Bloqueado";
        botaoPremium.style.backgroundColor = "#dc3545"; // Vermelho bloqueado
        botaoPremium.style.cursor = "not-allowed";
    }
}

// ========================================================
// 3. PREPARAÇÃO PARA O BANCO DE DADOS (Simulação)
// ========================================================
async function consultarAcessoNoBanco(idAparelho) {
    console.log(`🔍 Verificando status do aparelho ${idAparelho} no sistema...`);

    const dadosLocais = localStorage.getItem("futuraos_db_simulado");
    if (dadosLocais) {
        const dados = JSON.parse(dadosLocais);
        // Verifica se o tempo contratado ainda é válido
        if (dados.dataExpiracao && Date.now() < dados.dataExpiracao) {
            return { vipAtivo: true, expiracao: dados.dataExpiracao };
        }
    }
    
    return { vipAtivo: false, expiracao: null };
}

function salvarAcessoNoBanco(idAparelho, dias) {
    // Calcula o vencimento exato (Data de hoje + quantidade de dias comprados)
    const diasEmMs = dias * 24 * 60 * 60 * 1000;
    const dataVencimento = Date.now() + diasEmMs;

    const dadosParaSalvar = {
        deviceId: idAparelho,
        vipAtivo: true,
        dataExpiracao: dataVencimento,
        planoContratado: dias + " dias"
    };

    localStorage.setItem("futuraos_db_simulado", JSON.stringify(dadosParaSalvar));
    console.log(`💾 Aparelho ${idAparelho} registrado como VIP por ${dias} dias.`);
}

// ========================================================
// 4. FLUXO DE PAGAMENTO E VERIFICAÇÃO (5 EM 5 SEGUNDOS)
// ========================================================
async function iniciarProcessoPagamento(dias) {
    console.log(`🤖 Solicitando Pix para o plano de ${dias} dias...`);
    
    // Define o valor exato: se for 30 dias cobra 9.99, senão cobra 1.50
    let valor = (dias === 30) ? 9.99 : 1.50;
    
    try {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ valor: valor, email: "comprador@futuraos.com" })
        });

        const dados = await response.json();

        if (dados.status === "success") {
            alert(`PIX de R$ ${valor.toFixed(2)} Gerado!\n\nCopie o código abaixo para pagar no seu banco:\n\n${dados.qrcode_copia_cola}`);
            
            // Copia automaticamente para facilitar no celular
            navigator.clipboard.writeText(dados.qrcode_copia_cola);
            console.log("📋 Pix copiado para a área de transferência.");

            // Abre a checagem passando o ID do pagamento e os dias que o usuário comprou
            iniciarChecagemCincoSegundos(dados.id_pagamento, dias);
        } else {
            alert("Erro ao gerar pagamento: " + dados.message);
        }
    } catch (error) {
        console.error("Erro na comunicação com a API:", error);
    }
}

function iniciarChecagemCincoSegundos(idPagamento, dias) {
    if (intervaloChecagem) clearInterval(intervaloChecagem);

    console.log("⏳ Monitorando Mercado Pago de 5 em 5 segundos...");

    intervaloChecagem = setInterval(async () => {
        try {
            const response = await fetch(`${API_URL}?id=${idPagamento}`);
            const dados = await response.json();

            if (dados.status === "approved") {
                clearInterval(intervaloChecagem); 
                console.log("✅ Pagamento confirmado pelo Mercado Pago!");
                
                salvarAcessoNoBanco(idDoAparelho, dias); // Libera os dias certos (7 ou 30)
                atualizarBotaoPremiumUI("liberado"); // Destranca o botão
                alert(`🎉 Obrigado! Seu acesso VIP de ${dias} dias foi liberado com sucesso.`);
            } 
            else if (dados.status === "cancelled" || dados.status === "rejected") {
                clearInterval(intervaloChecagem);
                alert("❌ O pagamento foi cancelado ou recusado.");
            }
        } catch (error) {
            // Ignora oscilações temporárias de internet
        }
    }, 5000); // 5 segundos cravados
}

// ========================================================
// 5. INICIALIZAÇÃO AUTOMÁTICA AO ENTRAR NO SITE
// ========================================================
async function inicializarSistemaFuturaOS() {
    idDoAparelho = obterIdDispositivo();
    console.log(`📱 Seu ID de Aparelho é: ${idDoAparelho}`);

    const statusUsuario = await consultarAcessoNoBanco(idDoAparelho);

    if (statusUsuario.vipAtivo) {
        atualizarBotaoPremiumUI("liberado");
    } else {
        atualizarBotaoPremiumUI("bloqueado");
    }
}

window.onload = inicializarSistemaFuturaOS;
