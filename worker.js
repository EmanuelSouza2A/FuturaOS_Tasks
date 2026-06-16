// ============================================================
// FuturaOS_Tasks — Cloudflare Worker v4.1 (Zero Trust + KV)
// ============================================================
// VARIÁVEIS DE AMBIENTE — configure no painel da Cloudflare:
//   Workers & Pages → Seu Worker → Settings → Variables
//
//   MP_ACCESS_TOKEN  = APP_USR-8382747196121465-061518-5bfd6a6400bf5298ffe5006396e4adb7-3472009037
//   MP_PUBLIC_KEY    = APP_USR-970e40f2-f950-4577-a9f2-008359f05e0e
// 
// KV NAMESPACE — vincule no painel da Cloudflare:
//   Workers & Pages → Seu Worker → Settings → Variables → KV Namespace Bindings
//   Variable name: FT_KV  →  Namespace: (selecione ou crie "futura_os_kv")
//
// NUNCA exponha credenciais em texto plano no código de produção.
// ============================================================

// ── COFRE DE SCRIPTS (nunca enviado por completo ao cliente) ──
const BANCO_DE_SCRIPTS = {
  1:  { title: 'Taskitos',              code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  2:  { title: 'Redação Eclipse',       code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
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
  16: { title: 'Apostilas',             code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  17: { title: 'Cmsp Bots',             code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  18: { title: 'Alura Eclipse',         code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  19: { title: 'Khanware v3.0.9',       code: 'javascript:fetch("https://raw.githubusercontent.com/Niximkk/Khanware/refs/heads/main/Khanware.js").then(t=>t.text()).then(eval);' },
  20: { title: 'LeiaSP',                code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  21: { title: 'Redação Paraná',        code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  22: { title: 'Prepara SP',            code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
};

// ── ESTADO DE SESSÕES GRATUITAS (in-memory por instância) ──
const sessoesGratuitas = new Map();
const TEMPO_LIVRE_MS   = 10 * 60 * 1000;

// TTL de acesso por plano (em segundos)
const TTL_SEMANAL = 604800;  // 7 dias
const TTL_MENSAL  = 2592000; // 30 dias

// ── HELPERS ──
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-User-Id',
    },
  });
}

function corsPreFlight() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-User-Id',
      'Access-Control-Max-Age': '86400',
    },
  });
}

function sanitizeUserId(uid) {
  if (!uid || typeof uid !== 'string') return null;
  const clean = uid.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);
  return clean.length >= 8 ? clean : null;
}

// ── VERIFICAÇÃO DE ASSINATURA HMAC DO WEBHOOK ──
async function verificarAssinaturaWebhook(request, body, secret) {
  const assinaturaHeader = request.headers.get('x-signature') || '';
  const xRequestId       = request.headers.get('x-request-id') || '';
  const dataId           = body?.data?.id || '';
  const ts               = body?.ts ?? '';

  const stringParaValidar = `id:${dataId};request-id:${xRequestId};ts:${ts}`;
  const encoder    = new TextEncoder();
  const cryptoKey  = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(stringParaValidar));
  const signHex    = Array.from(new Uint8Array(signBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const v1Match = assinaturaHeader.match(/v1=([a-f0-9]+)/);
  return v1Match ? v1Match[1] === signHex : false;
}

// ── HANDLER PRINCIPAL ──
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS') return corsPreFlight();

    // ──────────────────────────────────────────────────────────────
    // POST /api/start-free
    // Inicia e valida o cronômetro de 10 minutos (relógio do servidor)
    // ──────────────────────────────────────────────────────────────
    if (method === 'POST' && url.pathname === '/api/start-free') {
      let body;
      try { body = await request.json(); } catch { return jsonResp({ error: 'JSON inválido' }, 400); }

      const userId = sanitizeUserId(body.userId);
      if (!userId) return jsonResp({ error: 'userId inválido ou ausente' }, 400);

      const agora           = Date.now();
      const sessaoExistente = sessoesGratuitas.get(userId);

      if (sessaoExistente && agora < sessaoExistente.liberadoEm) {
        const restanteSeg = Math.ceil((sessaoExistente.liberadoEm - agora) / 1000);
        return jsonResp({
          status: 'em_andamento',
          restanteSeg,
          liberadoEm: sessaoExistente.liberadoEm,
          mensagem: `Cronômetro ativo. Aguarde mais ${restanteSeg} segundos.`,
        });
      }

      const liberadoEm = agora + TEMPO_LIVRE_MS;
      sessoesGratuitas.set(userId, { iniciadoEm: agora, liberadoEm });

      return jsonResp({
        status: 'iniciado',
        iniciadoEm: agora,
        liberadoEm,
        duracaoSeg: TEMPO_LIVRE_MS / 1000,
        mensagem: 'Cronômetro iniciado. Script liberado em 10 minutos.',
      });
    }

    // ──────────────────────────────────────────────────────────────
    // POST /api/get-script
    // Verificação Zero-Trust: ignora qualquer flag do cliente.
    // Consulta o KV do servidor como única fonte de verdade.
    // ──────────────────────────────────────────────────────────────
    if (method === 'POST' && url.pathname === '/api/get-script') {
      let body;
      try { body = await request.json(); } catch { return jsonResp({ error: 'JSON inválido' }, 400); }

      const userId   = sanitizeUserId(body.userId || request.headers.get('X-User-Id'));
      const scriptId = parseInt(body.scriptId, 10);

      if (!userId)                          return jsonResp({ error: 'userId inválido ou ausente' }, 400);
      if (!scriptId || scriptId < 1 || scriptId > 22) return jsonResp({ error: 'scriptId inválido' }, 400);

      const script = BANCO_DE_SCRIPTS[scriptId];
      if (!script)                          return jsonResp({ error: 'Script não encontrado' }, 404);

      // ── VERIFICAÇÃO 1: Status premium no KV (fonte única de verdade) ──
      // O cliente NUNCA envia jaPagou — o servidor decide sozinho.
      const statusKV = await env.FT_KV.get(`premium:${userId}`);
      const isPremium = statusKV === 'ativo';

      if (isPremium) {
        return jsonResp({
          status:   'liberado',
          origem:   'premium',
          scriptId,
          title:    script.title,
          code:     script.code,
        });
      }

      // ── VERIFICAÇÃO 2: Cronômetro gratuito (fallback, sem flags do cliente) ──
      const agora  = Date.now();
      const sessao = sessoesGratuitas.get(userId);

      if (!sessao) {
        return jsonResp({
          status:   'bloqueado',
          codigo:   'SEM_SESSAO',
          mensagem: 'Inicie o cronômetro gratuito antes de acessar o script.',
        }, 403);
      }

      if (agora < sessao.liberadoEm) {
        const restanteSeg = Math.ceil((sessao.liberadoEm - agora) / 1000);
        return jsonResp({
          status:     'bloqueado',
          codigo:     'TEMPO_INSUFICIENTE',
          restanteSeg,
          mensagem:   `⛔ Acesso negado. Aguarde mais ${restanteSeg} segundos.`,
        }, 403);
      }

      // Cronômetro expirou — libera e limpa a sessão
      sessoesGratuitas.delete(userId);
      return jsonResp({
        status:   'liberado',
        origem:   'gratuito',
        scriptId,
        title:    script.title,
        code:     script.code,
      });
    }

    // ──────────────────────────────────────────────────────────────
    // POST /api/verify-premium
    // Endpoint chamado pelo botão "Já efetuei o pagamento".
    // Consulta o KV — não confia em nada que venha do cliente.
    // ──────────────────────────────────────────────────────────────
    if (method === 'POST' && url.pathname === '/api/verify-premium') {
      let body;
      try { body = await request.json(); } catch { return jsonResp({ error: 'JSON inválido' }, 400); }

      const userId = sanitizeUserId(body.userId || request.headers.get('X-User-Id'));
      if (!userId) return jsonResp({ error: 'userId inválido ou ausente' }, 400);

      const statusKV = await env.FT_KV.get(`premium:${userId}`);

      if (statusKV === 'ativo') {
        return jsonResp({ isPremium: true,  mensagem: 'Assinatura ativa confirmada.' });
      } else {
        return jsonResp({ isPremium: false, mensagem: 'Nenhuma assinatura ativa encontrada para este usuário.' }, 403);
      }
    }

    // ──────────────────────────────────────────────────────────────
    // POST /api/webhook-mp
    // Recebe notificações do Mercado Pago e persiste no KV.
    // ──────────────────────────────────────────────────────────────
    if (method === 'POST' && url.pathname === '/api/webhook-mp') {
      let body;
      try { body = await request.json(); } catch { return jsonResp({ error: 'JSON inválido' }, 400); }

      // Valida assinatura HMAC antes de processar qualquer dado
      const assinaturaValida = await verificarAssinaturaWebhook(request, body, env.MP_WEBHOOK_SECRET);
      if (!assinaturaValida) {
        return jsonResp({ error: 'Assinatura do webhook inválida.' }, 401);
      }

      const tipo = body?.type || body?.action || '';

      // ── Evento de pagamento aprovado ──
      if (tipo === 'payment' || tipo === 'payment.updated') {
        const paymentId = body?.data?.id;
        if (!paymentId) return jsonResp({ received: true });

        try {
          const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: { 'Authorization': `Bearer ${env.MP_ACCESS_TOKEN}` }
          });
          const pagamento = await mpRes.json();

          if (pagamento.status === 'approved') {
            // Extrai o userId do metadata do pagamento (deve ser enviado na criação da preferência)
            const userId = sanitizeUserId(pagamento?.metadata?.user_id || pagamento?.external_reference);

            if (userId) {
              // Detecta o plano pelo valor ou pelo preapproval_plan_id para definir o TTL correto
              const valor    = pagamento?.transaction_amount || 0;
              const ttl      = valor <= 2 ? TTL_SEMANAL : TTL_MENSAL;

              await env.FT_KV.put(`premium:${userId}`, 'ativo', { expirationTtl: ttl });
            }
          }
        } catch (err) {
          console.error('Erro ao consultar pagamento no MP:', err);
        }
      }

      // ── Evento de assinatura (preapproval) aprovada ──
      if (tipo === 'subscription_preapproval' || tipo === 'preapproval') {
        const preapprovalId = body?.data?.id;
        if (!preapprovalId) return jsonResp({ received: true });

        try {
          const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
            headers: { 'Authorization': `Bearer ${env.MP_ACCESS_TOKEN}` }
          });
          const assinatura = await mpRes.json();

          if (assinatura.status === 'authorized') {
            const userId = sanitizeUserId(assinatura?.external_reference);
            if (userId) {
              // Plano mensal: 30 dias; outros: 7 dias
              const ttl = assinatura?.auto_recurring?.transaction_amount > 2 ? TTL_MENSAL : TTL_SEMANAL;
              await env.FT_KV.put(`premium:${userId}`, 'ativo', { expirationTtl: ttl });
            }
          }

          // Cancela o acesso se a assinatura for suspensa ou cancelada
          if (['cancelled', 'paused'].includes(assinatura.status)) {
            const userId = sanitizeUserId(assinatura?.external_reference);
            if (userId) await env.FT_KV.delete(`premium:${userId}`);
          }
        } catch (err) {
          console.error('Erro ao consultar assinatura no MP:', err);
        }
      }

      return jsonResp({ received: true });
    }

    return jsonResp({ error: 'Rota não encontrada' }, 404);
  },
};
