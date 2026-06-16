export default {
  async fetch(request, env, ctx) {
    // RESOLUÇÃO COMPLETA DO ERRO DE CONEXÃO (Injeção de Headers CORS Globais)
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.URL || request.url);

    // 1. ENDPOINT: CRIAR PAGAMENTO PIX REAL DENTRO DO SITE
    if (url.pathname === "/api/create-payment" && request.method === "POST") {
      try {
        const { plano, userId } = await request.json();
        const valor = plano === "semanal" ? 1.50 : 9.99;
        const dias = plano === "semanal" ? 7 : 30;

        // Requisição segura de nível de produção para o Mercado Pago
        const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.MP_ACCESS_TOKEN}`, // Protegido via Variável de Ambiente
            "Content-Type": "application/json",
            "X-Idempotency-Key": crypto.randomUUID()
          },
          body: JSON.stringify({
            transaction_amount: valor,
            description: `Acesso Premium FuturaOS - ${dias} Dias`,
            payment_method_id: "pix",
            payer: {
              email: `${userId}@futuraostasks.com`,
              first_name: "Usuario",
              last_name: "FuturaOS"
            },
            notification_url: `https://seudominio.com/api/webhook?userId=${userId}&dias=${dias}`
          })
        });

        const mpData = await mpResponse.json();

        // Extrai a imagem em Base64 e o código Copia e Cola gerados na hora pelo Mercado Pago
        const qrCodeBase64 = mpData.point_of_interaction.transaction_data.qr_code_base64;
        const qrCode = mpData.point_of_interaction.transaction_data.qr_code;

        return new Response(JSON.stringify({ qr_code_base64, qr_code, id: mpData.id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Falha na requisição PIX" }), { status: 500, headers: corsHeaders });
      }
    }

    // 2. ENDPOINT: WEBHOOK RECEBER CONFIRMAÇÃO DE PAGAMENTO AUTOMÁTICO
    if (url.pathname === "/api/webhook") {
      const userId = url.searchParams.get("userId");
      const dias = parseInt(url.searchParams.get("dias") || "7");
      
      // Salva no banco de dados da Cloudflare KV com tempo de expiração real (7 ou 30 dias)
      const segundosExpiracao = dias * 24 * 60 * 60;
      await env.FUTURA_KV.put(`user:${userId}:status`, "premium", { expirationTtl: segundosExpiracao });

      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // 3. ENDPOINT: VERIFICAR STATUS DO USUÁRIO
    if (url.pathname === "/api/check-status") {
      const userId = url.searchParams.get("userId");
      const status = await env.FUTURA_KV.get(`user:${userId}:status`);
      
      return new Response(JSON.stringify({ status: status || "free" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 4. ENDPOINT: CRONÔMETRO SEGURO NO SERVIDOR
    if (url.pathname === "/api/start-timer" && request.method === "POST") {
      const { userId } = await request.json();
      let startTime = await env.FUTURA_KV.get(`user:${userId}:timer`);
      
      if (!startTime) {
        startTime = Date.now().toString();
        // Armazena o timestamp de quando a pessoa iniciou a espera
        await env.FUTURA_KV.put(`user:${userId}:timer`, startTime, { expirationTtl: 3600 });
      }

      return new Response(JSON.stringify({ startTime: parseInt(startTime) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response("Endpoint não encontrado", { status: 404, headers: corsHeaders });
  }
};
