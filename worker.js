// ============================================================
// FuturaOS_Tasks — Cloudflare Worker (Back-end Zero Trust)
// ============================================================
// VARIÁVEIS DE AMBIENTE — configure no painel da Cloudflare:
//   Workers & Pages → Seu Worker → Settings → Variables
//
//   MP_PUBLIC_KEY    = APP_USR-03c8841f-1280-4e5e-9afe-7cf49654dff3
//   MP_ACCESS_TOKEN  = APP_USR-520505663956170-061508-ca22aae90b7bffe048f76dfe0455be83-2380191603
//   MP_CLIENT_ID     = 520505663956170
//   MP_CLIENT_SECRET = JF7o1nNTVsWpUkmEgsVhVxIJCGHkckst
//   MP_WEBHOOK_SECRET= c4393a31d736ee5fc70081559f6833d76cbe88135f6f58d0df8be64984e6e89c
//
// NUNCA exponha esses valores diretamente no código de produção.
// Acesse via: env.MP_ACCESS_TOKEN, env.MP_WEBHOOK_SECRET, etc.
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

// ── ESTADO DE SESSÕES GRATUITAS (in-memory, por instância do Worker) ──
const sessoesGratuitas = new Map();
// { userId: { iniciadoEm: timestamp_ms, liberadoEm: timestamp_ms } }

const TEMPO_LIVRE_MS = 10 * 60 * 1000; // 10 minutos em ms

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

// ── HANDLER PRINCIPAL ──
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS') return corsPreFlight();

    // ── POST /api/start-free ──────────────────────────────────────
    if (method === 'POST' && url.pathname === '/api/start-free') {
      let body;
      try { body = await request.json(); } catch { return jsonResp({ error: 'JSON inválido' }, 400); }

      const userId = sanitizeUserId(body.userId);
      if (!userId) return jsonResp({ error: 'userId inválido ou ausente' }, 400);

      const agora = Date.now();
      const sessaoExistente = sessoesGratuitas.get(userId);

      // Se já existe sessão ativa, retorna o tempo restante sem reiniciar
      if (sessaoExistente && agora < sessaoExistente.liberadoEm) {
        const restanteMs  = sessaoExistente.liberadoEm - agora;
        const restanteSeg = Math.ceil(restanteMs / 1000);
        return jsonResp({
          status: 'em_andamento',
          restanteSeg,
          liberadoEm: sessaoExistente.liberadoEm,
          mensagem: `Você já iniciou o cronômetro. Aguarde mais ${restanteSeg} segundos.`,
        });
      }

      // Inicia nova sessão
      const liberadoEm = agora + TEMPO_LIVRE_MS;
      sessoesGratuitas.set(userId, { iniciadoEm: agora, liberadoEm });

      return jsonResp({
        status: 'iniciado',
        iniciadoEm: agora,
        liberadoEm,
        duracaoSeg: TEMPO_LIVRE_MS / 1000,
        mensagem: 'Cronômetro iniciado. O script será liberado em 10 minutos.',
      });
    }

    // ── POST /api/get-script ──────────────────────────────────────
    if (method === 'POST' && url.pathname === '/api/get-script') {
      let body;
      try { body = await request.json(); } catch { return jsonResp({ error: 'JSON inválido' }, 400); }

      const userId   = sanitizeUserId(body.userId);
      const scriptId = parseInt(body.scriptId, 10);
      const jaPagou  = body.jaPagou === true;

      if (!userId)               return jsonResp({ error: 'userId inválido ou ausente' }, 400);
      if (!scriptId || scriptId < 1 || scriptId > 22)
                                 return jsonResp({ error: 'scriptId inválido' }, 400);

      const script = BANCO_DE_SCRIPTS[scriptId];
      if (!script)               return jsonResp({ error: 'Script não encontrado' }, 404);

      // Caminho Premium — pagamento validado
      if (jaPagou) {
        // TODO: valide o token/assinatura real do Mercado Pago aqui via env.MP_ACCESS_TOKEN
        // Por ora, confia na flag; em produção substitua por verificação de assinatura ativa na API do MP
        return jsonResp({
          status: 'liberado',
          origem: 'premium',
          scriptId,
          title: script.title,
          code: script.code,
        });
      }

      // Caminho Gratuito — valida cronômetro do servidor
      const agora = Date.now();
      const sessao = sessoesGratuitas.get(userId);

      if (!sessao) {
        return jsonResp({
          status: 'bloqueado',
          codigo: 'SEM_SESSAO',
          mensagem: 'Você ainda não iniciou o cronômetro gratuito. Inicie antes de acessar o script.',
        }, 403);
      }

      if (agora < sessao.liberadoEm) {
        const restanteSeg = Math.ceil((sessao.liberadoEm - agora) / 1000);
        return jsonResp({
          status: 'bloqueado',
          codigo: 'TEMPO_INSUFICIENTE',
          restanteSeg,
          mensagem: `⛔ Acesso negado. Aguarde mais ${restanteSeg} segundos no servidor.`,
        }, 403);
      }

      // Cronômetro expirou — libera e remove a sessão
      sessoesGratuitas.delete(userId);
      return jsonResp({
        status: 'liberado',
        origem: 'gratuito',
        scriptId,
        title: script.title,
        code: script.code,
      });
    }

    // ── POST /api/webhook-mp ──────────────────────────────────────
    if (method === 'POST' && url.pathname === '/api/webhook-mp') {
      let body;
      try { body = await request.json(); } catch { return jsonResp({ error: 'JSON inválido' }, 400); }

      // Verificação de assinatura HMAC do Mercado Pago
      const assinaturaRecebida = request.headers.get('x-signature') || '';
      const xRequestId         = request.headers.get('x-request-id') || '';
      const dataId             = body?.data?.id || '';

      // Montagem da string de validação conforme documentação do MP
      const stringParaValidar = `id:${dataId};request-id:${xRequestId};ts:${body?.ts ?? ''}`;

      const encoder  = new TextEncoder();
      const keyData  = encoder.encode(env.MP_WEBHOOK_SECRET);
      const msgData  = encoder.encode(stringParaValidar);
      const cryptoKey = await crypto.subtle.importKey(
        'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
      const signBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
      const signHex    = Array.from(new Uint8Array(signBuffer))
        .map(b => b.toString(16).padStart(2, '0')).join('');

      // Extrai apenas o valor "v1=..." do header x-signature
      const v1Match = assinaturaRecebida.match(/v1=([a-f0-9]+)/);
      const v1      = v1Match ? v1Match[1] : '';

      if (v1 !== signHex) {
        return jsonResp({ error: 'Assinatura inválida' }, 401);
      }

      // TODO: processar o evento — ex: marcar userId como premium no KV do Cloudflare
      // const { type, data } = body;
      // if (type === 'payment') { ... await env.FT_KV.put(`premium:${userId}`, '1'); }

      return jsonResp({ received: true });
    }

    return jsonResp({ error: 'Rota não encontrada' }, 404);
  },
};
