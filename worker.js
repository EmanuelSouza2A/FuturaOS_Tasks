export default {
  async fetch(request, env, ctx) {
    // RESOLUÇÃO DEFINITIVA DO ERRO DE CONEXÃO (Injeção Global de CORS)
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Pre-flight request do navegador resolvida na hora
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ROUTER 1: CRIAR PAGAMENTO DINÂMICO VIA MERCADO PAGO API
    if (url.pathname === "/api/create-payment" && request.method === "POST") {
      try {
        const { plano, userId } = await request.json();
        const valorTransacao = plano === "semanal" ? 1.50 : 9.99;
        const diasAcesso = plano === "semanal" ? 7 : 30;

        // Chamada HTTP em conformidade com as regras de produção do Mercado Pago
        const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.MP_ACCESS_TOKEN}`, // Protegido nas variáveis ocultas da Cloudflare
            "Content-Type": "application/json",
            "X-Idempotency-Key": crypto.randomUUID() // Evita duplicidade de cobrança
          },
          body: JSON.stringify({
            transaction_amount: valorTransacao,
            description: `FuturaOS Tasks Premium - ${diasAcesso} Dias`,
            payment_method_id: "pix",
            payer: {
              email: `${userId}@futuraos.internal`,
              first_name: "Cliente",
              last_name: "FuturaOS"
            },
            // O próprio Mercado Pago envia o retorno para cá anexando o ID e Dias na URL
            notification_url: `${url.origin}/api/webhook?userId=${userId}&dias=${diasAcesso}`
          })
        });

        if (!mpResponse.ok) {
          const rawError = await mpResponse.text();
          return new Response(JSON.stringify({ error: "Erro Mercado Pago", details: rawError }), { status: 500, headers: corsHeaders });
        }

        const mpData = await mpResponse.json();

        // Isolamento das strings brutas necessárias para renderizar o PIX em tela
        const payloadResposta = {
          qr_code_base64: mpData.point_of_interaction.transaction_data.qr_code_base64,
          qr_code: mpData.point_of_interaction.transaction_data.qr_code,
          payment_id: mpData.id
        };

        return new Response(JSON.stringify(payloadResposta), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: "Internal Server Error", message: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ROUTER 2: WEBHOOK DO MERCADO PAGO (Aprovação imediata)
    if (url.pathname === "/api/webhook") {
      try {
        const targetUser = url.searchParams.get("userId");
        const totalDias = parseInt(url.searchParams.get("dias") || "7");
        
        // Converte dias em segundos para expiração automática nativa do banco Cloudflare KV
        const ttlSegundos = totalDias * 24 * 60 * 60;

        if (targetUser) {
          // Grava o status diretamente na memória estável da Cloudflare
          await env.FUTURA_KV.put(`user:${targetUser}:status`, "premium", { expirationTtl: ttlSegundos });
          return new Response("WEBHOOK_PROCESSED_SUCCESS", { status: 200, headers: corsHeaders });
        }
        return new Response("Missing parameters", { status: 400, headers: corsHeaders });
      } catch (kvErr) {
        return new Response("KV Storage Error", { status: 500, headers: corsHeaders });
      }
    }

    // ROUTER 3: VALIDAÇÃO DE STATUS EM TEMPO REAL (Anti-Bypass)
    if (url.pathname === "/api/check-status" && request.method === "GET") {
      const queryUser = url.searchParams.get("userId");
      if (!queryUser) {
        return new Response(JSON.stringify({ error: "Missing userId" }), { status: 400, headers: corsHeaders });
      }

      // 1. Checa se ele comprou o plano pago
      let statusKV = await env.FUTURA_KV.get(`user:${queryUser}:status`);
      if (statusKV === "premium") {
        return new Response(JSON.stringify({ status: "premium" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 2. Checa se ele cumpriu o cronômetro gratuito de 10 minutos
      let timerStart = await env.FUTURA_KV.get(`user:${queryUser}:timer`);
      if (timerStart) {
        let tempoDecorrido = Date.now() - parseInt(timerStart);
        if (tempoDecorrido >= 600000) { // 600000 ms = 10 minutos cravados
          // Dá 2 horas de acesso gratuito como prêmio por assistir/esperar os 10 min
          await env.FUTURA_KV.put(`user:${queryUser}:status`, "premium", { expirationTtl: 7200 });
          return new Response(JSON.stringify({ status: "premium" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      return new Response(JSON.stringify({ status: "free" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ROUTER 4: INICIALIZAÇÃO E PERSISTÊNCIA DO CRONÔMETRO NO SERVIDOR
    if (url.pathname === "/api/start-timer" && request.method === "POST") {
      const { userId } = await request.json();
      
      let currentTimer = await env.FUTURA_KV.get(`user:${userId}:timer`);
      
      // Se ele nunca iniciou o cronômetro, cria o carimbo de hora atual no servidor
      if (!currentTimer) {
        currentTimer = Date.now().toString();
        // O timer expira em 1 hora caso o usuário desista e feche o site
        await env.FUTURA_KV.put(`user:${userId}:timer`, currentTimer, { expirationTtl: 3600 });
      }

      return new Response(JSON.stringify({ startTime: parseInt(currentTimer) }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};
