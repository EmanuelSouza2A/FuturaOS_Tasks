const BANCO_DE_SCRIPTS = {
  1:  { title: 'Taskitos',             code: 'javascript:alert("Payload do Taskitos Ativo!");' },
  2:  { title: 'Redação Eclipse',      code: 'javascript:alert("Payload do Redação Eclipse!");' },
  3:  { title: 'Khanto',                code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  4:  { title: 'Elefante Letrado',      code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  5:  { title: 'Matific',               code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  6:  { title: 'Tarefas SP',            code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  7:  { title: 'Redação Neji',          code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  8:  { title: 'Educação Profissional', code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  9:  { title: 'Open English',          code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  10: { title: 'Apostilas Neji',        code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  11: { title: 'Speak',                 code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  12: { title: 'Redação Paulista',      code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  13: { title: 'Khan Eclipse',          code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  14: { title: 'Expansão Noturna',      code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  15: { title: 'Livro do Estudante',    code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  16: { title: 'Apostilas',              code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  17: { title: 'Cmsp Bots',             code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  18: { title: 'Alura Eclipse',         code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  19: { title: 'Khanware v3.0.9',       code: 'javascript:fetch("https://raw.githubusercontent.com/Niximkk/Khanware/refs/heads/main/Khanware.js").then(t=>t.text()).then(eval);' },
  20: { title: 'LeiaSP',                 code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  21: { title: 'Redação Paraná',         code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  22: { title: 'Prepara SP',            code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
};

const TEMPO_LIVRE_MS = 10 * 60 * 1000; // 10 minutos cravados

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-User-Id',
    },
  });
}

function sanitizeUserId(uid) {
  if (!uid || typeof uid !== 'string') return null;
  return uid.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // Pre-flight CORS resolvida imediatamente
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 24,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    try {
      // ── ROUTER 1: INTEGRAÇÃO DIRETA COM MERCADO PAGO ──
      if (method === 'POST' && url.pathname === '/api/create-payment') {
        const { plano, userId } = await request.json();
        const valorTransacao = plano === 'semanal' ? 1.50 : 9.99;
        const diasAcesso = plano === 'semanal' ? 7 : 30;

        const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.MP_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
            "X-Idempotency-Key": crypto.randomUUID()
          },
          body: JSON.stringify({
            transaction_amount: valorTransacao,
            description: `FuturaOS Tasks Premium - ${diasAcesso} Dias`,
            payment_method_id: "pix",
            payer: {
              email: `${userId}@futuraos.internal`,
              first_name: "Usuario",
              last_name: "Futura"
            },
            notification_url: `${url.origin}/api/webhook?userId=${userId}&dias=${diasAcesso}`
          })
        });

        const mpData = await mpResponse.json();
        
        return jsonResp({
          qr_code_base64: mpData.point_of_interaction.transaction_data.qr_code_base64,
          qr_code: mpData.point_of_interaction.transaction_data.qr_code,
          payment_id: mpData.id
        });
      }

      // ── ROUTER 2: START-FREE PERSISTIDO NO KV ──
      if (method === 'POST' && url.pathname === '/api/start-free') {
        const body = await request.json();
        const userId = sanitizeUserId(body.userId);
        if (!userId) return jsonResp({ error: 'userId inválido' }, 400);

        const agora = Date.now();
        // Procura no KV se o timer já rodava antes para evitar bypass de refresh
        let dataLiberacao = await env.FUTURA_KV.get(`user:${userId}:timer`);
        
        if (!dataLiberacao) {
          dataLiberacao = (agora + TEMPO_LIVRE_MS).toString();
          // Salva com TTL de 1 hora para limpar memória de inativos
          await env.FUTURA_KV.put(`user:${userId}:timer`, dataLiberacao, { expirationTtl: 3600 });
        }

        return jsonResp({
          status: 'sincronizado',
          liberadoEm: parseInt(dataLiberacao)
        });
      }

      // ── ROUTER 3: CHECK STATUS DE ACESSO TOTAL ──
      if (url.pathname === '/api/check-status') {
        const userId = method === 'POST' 
          ? (await request.json().catch(() => ({}))).userId 
          : url.searchParams.get('userId');

        const cleanUid = sanitizeUserId(userId);
        if (!cleanUid) return jsonResp({ error: 'userId ausente' }, 400);

        // 1. Checa plano Premium Ativo
        const premiumStatus = await env.FUTURA_KV.get(`user:${cleanUid}:status`);
        if (premiumStatus === 'premium') {
          return jsonResp({ status: 'premium', motivo: 'assinatura_ativa' });
        }

        // 2. Checa bônus do cronômetro gratuito concluído
        const bonusStatus = await env.FUTURA_KV.get(`user:${cleanUid}:bonus`);
        if (bonusStatus === 'liberado') {
          return jsonResp({ status: 'premium', motivo: 'bonus_gratuito_2h' });
        }

        return jsonResp({ status: 'free' });
      }

      // ── ROUTER 4: SECURE SCRIPT DELIVERY ──
      if (method === 'POST' && url.pathname === '/api/get-script') {
        const body = await request.json();
        const userId = sanitizeUserId(body.userId);
        const scriptId = parseInt(body.scriptId, 10);

        const premiumCheck = await env.FUTURA_KV.get(`user:${userId}:status`);
        const bonusCheck = await env.FUTURA_KV.get(`user:${userId}:bonus`);
        
        const autorizado = (premiumCheck === 'premium' || bonusCheck === 'liberado');

        // Se não tiver plano pago, valida se o tempo do timer no servidor bate com a liberação
        if (!autorizado) {
          const dataLiberacao = await env.FUTURA_KV.get(`user:${userId}:timer`);
          if (!dataLiberacao || Date.now() < parseInt(dataLiberacao)) {
            const restanteSeg = dataLiberacao ? Math.ceil((parseInt(dataLiberacao) - Date.now()) / 1000) : 600;
            return jsonResp({
              status: 'bloqueado',
              codigo: 'TEMPO_INSUFICIENTE',
              mensagem: `⛔ Acesso Negado. Faltam ${restanteSeg} segundos de validação no servidor.`
            }, 403);
          }

          // Se chegou aqui, ele bateu o tempo gratuito! Dá 2h de bônus no KV
          await env.FUTURA_KV.put(`user:${userId}:bonus`, 'liberado', { expirationTtl: 7200 });
          await env.FUTURA_KV.delete(`user:${userId}:timer`);
        }

        const script = BANCO_DE_SCRIPTS[scriptId];
        if (!script) return jsonResp({ error: 'Script inválido' }, 404);

        return jsonResp({
          status: 'liberado',
          scriptId,
          title: script.title,
          code: script.code
        });
      }

      // ── ROUTER 5: WEBHOOK DO MERCADO PAGO ──
      if (url.pathname === '/api/webhook') {
        const targetUser = sanitizeUserId(url.searchParams.get("userId"));
        const totalDias = parseInt(url.searchParams.get("dias") || "7");
        const ttlSegundos = totalDias * 24 * 60 * 60;

        if (targetUser) {
          await env.FUTURA_KV.put(`user:${targetUser}:status`, "premium", { expirationTtl: ttlSegundos });
          return jsonResp({ success: true, message: "Pagamento ativo no KV!" });
        }
        return jsonResp({ error: "Parâmetros ausentes" }, 400);
      }

      return jsonResp({ error: 'Rota não encontrada' }, 404);

    } catch (error) {
      return jsonResp({ error: 'Erro de processamento interno', details: error.message }, 500);
    }
  }
};
