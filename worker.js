// ============================================================
// FuturaOS_Tasks — Cloudflare Worker (Zero Trust + KV)
// ============================================================
// Configure no painel da Cloudflare:
//   MP_ACCESS_TOKEN  = [seu token]
//   MP_WEBHOOK_SECRET= [seu webhook secret]
//   FT_KV            = [KV Namespace binding]
// ============================================================

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
  19: { title: 'Khanware v3.0.9',       code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  20: { title: 'LeiaSP',                code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  21: { title: 'Redação Paraná',        code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
  22: { title: 'Prepara SP',            code: '// PAYLOAD_REAL_DO_SCRIPT_AQUI' },
};

const sessoesGratuitas = new Map();
const TEMPO_LIVRE_MS = 10 * 60 * 1000;

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

async function webhookAssinado(request, body, secret) {
  const sig = request.headers.get('x-signature') || '';
  const xRequestId = request.headers.get('x-request-id') || '';
  const dataId = body?.data?.id || '';
  const ts = body?.ts ?? '';
  const raw = `id:${dataId};request-id:${xRequestId};ts:${ts}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const out = await crypto.subtle.sign('HMAC', key, enc.encode(raw));
  const hex = Array.from(new Uint8Array(out)).map(b => b.toString(16).padStart(2, '0')).join('');
  const m = sig.match(/v1=([a-f0-9]+)/);
  return !!m && m[1] === hex;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS') return corsPreFlight();

    if (method === 'POST' && url.pathname === '/api/start-free') {
      let body;
      try { body = await request.json(); } catch { return jsonResp({ error: 'JSON inválido' }, 400); }

      const userId = sanitizeUserId(body.userId);
      if (!userId) return jsonResp({ error: 'userId inválido ou ausente' }, 400);

      const agora = Date.now();
      const sessao = sessoesGratuitas.get(userId);

      if (sessao && agora < sessao.liberadoEm) {
        return jsonResp({
          status: 'em_andamento',
          restanteSeg: Math.ceil((sessao.liberadoEm - agora) / 1000),
          liberadoEm: sessao.liberadoEm,
        });
      }

      sessoesGratuitas.set(userId, {
        iniciadoEm: agora,
        liberadoEm: agora + TEMPO_LIVRE_MS,
      });

      return jsonResp({
        status: 'iniciado',
        iniciadoEm: agora,
        liberadoEm: agora + TEMPO_LIVRE_MS,
      });
    }

    if (method === 'POST' && url.pathname === '/api/get-script') {
      let body;
      try { body = await request.json(); } catch { return jsonResp({ error: 'JSON inválido' }, 400); }

      const userId = sanitizeUserId(body.userId || request.headers.get('X-User-Id'));
      const scriptId = parseInt(body.scriptId, 10);

      if (!userId) return jsonResp({ error: 'userId inválido ou ausente' }, 400);
      if (!scriptId || scriptId < 1 || scriptId > 22) return jsonResp({ error: 'scriptId inválido' }, 400);

      const script = BANCO_DE_SCRIPTS[scriptId];
      if (!script) return jsonResp({ error: 'Script não encontrado' }, 404);

      const statusKV = await env.FT_KV.get(`premium:${userId}`);

      if (statusKV === 'ativo') {
        return jsonResp({
          status: 'liberado',
          origem: 'premium',
          scriptId,
          title: script.title,
          code: script.code,
        });
      }

      const agora = Date.now();
      const sessao = sessoesGratuitas.get(userId);

      if (!sessao) {
        return jsonResp({
          status: 'bloqueado',
          codigo: 'SEM_SESSAO',
          mensagem: 'Inicie o cronômetro gratuito antes de acessar o script.',
        }, 403);
      }

      if (agora < sessao.liberadoEm) {
        return jsonResp({
          status: 'bloqueado',
          codigo: 'TEMPO_INSUFICIENTE',
          restanteSeg: Math.ceil((sessao.liberadoEm - agora) / 1000),
          mensagem: '⛔ Acesso negado. Aguarde o tempo do servidor.',
        }, 403);
      }

      sessoesGratuitas.delete(userId);
      return jsonResp({
        status: 'liberado',
        origem: 'gratuito',
        scriptId,
        title: script.title,
        code: script.code,
      });
    }

    if (method === 'POST' && url.pathname === '/api/webhook-mp') {
      let body;
      try { body = await request.json(); } catch { return jsonResp({ error: 'JSON inválido' }, 400); }

      const ok = await webhookAssinado(request, body, env.MP_WEBHOOK_SECRET);
      if (!ok) return jsonResp({ error: 'Assinatura do webhook inválida' }, 401);

      const tipo = body?.type || body?.action || '';
      const paymentId = body?.data?.id;

      if (tipo === 'payment' && paymentId) {
        try {
          const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
          });
          const pagamento = await res.json();

          if (pagamento.status === 'approved') {
            const userId = sanitizeUserId(pagamento?.metadata?.user_id || pagamento?.external_reference);
            if (userId) {
              await env.FT_KV.put(`premium:${userId}`, 'ativo', { expirationTtl: 604800 });
            }
          }
        } catch (e) {
          console.error(e);
        }
      }

      return jsonResp({ received: true });
    }

    return jsonResp({ error: 'Rota não encontrada' }, 404);
  },
};
