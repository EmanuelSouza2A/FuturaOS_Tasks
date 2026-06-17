/**
 * Cloudflare Worker — Gateway de Pagamento Mercado Pago
 *
 * Variáveis de Ambiente necessárias (configure no painel do Cloudflare):
 *   MP_ACCESS_TOKEN  — Access Token do Mercado Pago (Secret)
 *   KV               — Binding do KV Namespace (ex: "ACESSO_KV")
 *
 * KV Namespace: crie um com nome "ACESSO_KV" e vincule como "KV" no Worker.
 */

// ─── Constantes ──────────────────────────────────────────────────────────────

const PLANOS = {
  semanal: { valor: 1.99, descricao: "Acesso Semanal", dias: 7 },
  mensal:  { valor: 9.99, descricao: "Acesso Mensal",  dias: 30 },
};

const TIMER_DURACAO_MS = 10 * 60 * 1000; // 10 minutos em milissegundos

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Retorna headers CORS padrão.
 * Ajuste a origem conforme necessário (ex: "https://meusite.com").
 */
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-ID",
    "Access-Control-Max-Age": "86400",
  };
}

/** Resposta JSON padronizada */
function jsonResponse(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

/** Resposta de erro padronizada */
function errorResponse(mensagem, status = 400, origin) {
  return jsonResponse({ ok: false, erro: mensagem }, status, origin);
}

/**
 * Gera ou valida um userID a partir do header X-User-ID.
 * O frontend deve gerar um UUID e armazená-lo no localStorage,
 * enviando-o em toda requisição via este header.
 */
function getUserID(request) {
  const id = request.headers.get("X-User-ID");
  if (!id || id.length < 8) return null;
  return id.substring(0, 64); // limita tamanho por segurança
}

// ─── Roteador principal ───────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const url    = new URL(request.url);
    const path   = url.pathname;

    // Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      // POST /criar-pagamento — cria cobrança PIX no Mercado Pago
      if (path === "/criar-pagamento" && request.method === "POST") {
        return await criarPagamento(request, env, origin);
      }

      // GET /verificar-acesso — consulta se o userID tem acesso liberado
      if (path === "/verificar-acesso" && request.method === "GET") {
        return await verificarAcesso(request, env, origin);
      }

      // POST /iniciar-timer — inicia o contador de 10 min no servidor
      if (path === "/iniciar-timer" && request.method === "POST") {
        return await iniciarTimer(request, env, origin);
      }

      // GET /status-timer — consulta quanto tempo resta no timer
      if (path === "/status-timer" && request.method === "GET") {
        return await statusTimer(request, env, origin);
      }

      // POST /webhook/mercadopago — recebe notificação de pagamento
      if (path === "/webhook/mercadopago" && request.method === "POST") {
        return await webhookMercadoPago(request, env, origin);
      }

      // GET /validar-token — valida token de acesso para scripts externos
      if (path === "/validar-token" && request.method === "GET") {
        return await validarToken(request, env, origin);
      }

      return errorResponse("Rota não encontrada", 404, origin);
    } catch (err) {
      console.error("Erro interno:", err);
      return errorResponse("Erro interno do servidor: " + err.message, 500, origin);
    }
  },
};

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * POST /criar-pagamento
 * Body: { plano: "semanal" | "mensal" }
 * Header: X-User-ID
 */
async function criarPagamento(request, env, origin) {
  const userID = getUserID(request);
  if (!userID) return errorResponse("X-User-ID ausente ou inválido", 400, origin);

  const body = await request.json().catch(() => null);
  if (!body || !PLANOS[body.plano]) {
    return errorResponse("Plano inválido. Use 'semanal' ou 'mensal'", 400, origin);
  }

  const plano = PLANOS[body.plano];

  // Verifica se o usuário já tem acesso ativo (evita cobrar novamente)
  const acessoAtual = await env.KV.get(`acesso:${userID}`, "json");
  if (acessoAtual && acessoAtual.expiraEm > Date.now()) {
    return jsonResponse({
      ok: true,
      mensagem: "Usuário já possui acesso ativo",
      expiraEm: acessoAtual.expiraEm,
    }, 200, origin);
  }

  // Cria preferência de pagamento no Mercado Pago
  const payload = {
    transaction_amount: plano.valor,
    description: plano.descricao,
    payment_method_id: "pix",
    payer: {
      email: `usuario-${userID.substring(0, 8)}@pagamento.temp`,
    },
    external_reference: `${userID}|${body.plano}`,
    notification_url: `${new URL(request.url).origin}/webhook/mercadopago`,
  };

  const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
      "X-Idempotency-Key": `${userID}-${body.plano}-${Date.now()}`,
    },
    body: JSON.stringify(payload),
  });

  const mpData = await mpResponse.json();

  if (!mpResponse.ok) {
    console.error("Erro Mercado Pago:", mpData);
    return errorResponse(
      "Erro ao criar pagamento: " + (mpData.message || "verifique o Access Token"),
      502,
      origin
    );
  }

  const pix = mpData.point_of_interaction?.transaction_data;

  return jsonResponse({
    ok: true,
    pagamentoID: mpData.id,
    plano: body.plano,
    valor: plano.valor,
    qrCode: pix?.qr_code,
    qrCodeBase64: pix?.qr_code_base64,
    copiaCola: pix?.qr_code,
    status: mpData.status,
  }, 200, origin);
}

/**
 * GET /verificar-acesso
 * Header: X-User-ID
 */
async function verificarAcesso(request, env, origin) {
  const userID = getUserID(request);
  if (!userID) return errorResponse("X-User-ID ausente ou inválido", 400, origin);

  const acesso = await env.KV.get(`acesso:${userID}`, "json");

  if (!acesso) {
    return jsonResponse({ ok: true, liberado: false, motivo: "sem_acesso" }, 200, origin);
  }

  if (acesso.expiraEm <= Date.now()) {
    await env.KV.delete(`acesso:${userID}`);
    return jsonResponse({ ok: true, liberado: false, motivo: "expirado" }, 200, origin);
  }

  return jsonResponse({
    ok: true,
    liberado: true,
    motivo: acesso.motivo || "pagamento",
    expiraEm: acesso.expiraEm,
    plano: acesso.plano,
  }, 200, origin);
}

/**
 * POST /iniciar-timer
 * Header: X-User-ID
 * Inicia um timer de 10 minutos no servidor. Ao expirar, libera acesso por timer.
 */
async function iniciarTimer(request, env, origin) {
  const userID = getUserID(request);
  if (!userID) return errorResponse("X-User-ID ausente ou inválido", 400, origin);

  // Verifica se já existe timer em andamento para este usuário
  const timerExistente = await env.KV.get(`timer:${userID}`, "json");
  if (timerExistente) {
    const restante = timerExistente.terminaEm - Date.now();
    if (restante > 0) {
      return jsonResponse({
        ok: true,
        mensagem: "Timer já em andamento",
        terminaEm: timerExistente.terminaEm,
        restanteMs: restante,
      }, 200, origin);
    }
    // Timer expirado — libera acesso
    await liberarAcessoPorTimer(userID, env);
    return jsonResponse({ ok: true, mensagem: "Timer expirado, acesso liberado", liberado: true }, 200, origin);
  }

  const terminaEm = Date.now() + TIMER_DURACAO_MS;
  await env.KV.put(
    `timer:${userID}`,
    JSON.stringify({ iniciouEm: Date.now(), terminaEm }),
    { expirationTtl: Math.ceil(TIMER_DURACAO_MS / 1000) + 60 } // TTL em segundos + margem
  );

  return jsonResponse({
    ok: true,
    mensagem: "Timer iniciado no servidor",
    terminaEm,
    duracaoMs: TIMER_DURACAO_MS,
  }, 200, origin);
}

/**
 * GET /status-timer
 * Header: X-User-ID
 */
async function statusTimer(request, env, origin) {
  const userID = getUserID(request);
  if (!userID) return errorResponse("X-User-ID ausente ou inválido", 400, origin);

  const timer = await env.KV.get(`timer:${userID}`, "json");
  if (!timer) {
    return jsonResponse({ ok: true, timerAtivo: false }, 200, origin);
  }

  const restanteMs = timer.terminaEm - Date.now();

  if (restanteMs <= 0) {
    // Timer expirou — libera acesso e limpa o timer
    await liberarAcessoPorTimer(userID, env);
    await env.KV.delete(`timer:${userID}`);
    return jsonResponse({ ok: true, timerAtivo: false, liberado: true }, 200, origin);
  }

  return jsonResponse({
    ok: true,
    timerAtivo: true,
    terminaEm: timer.terminaEm,
    restanteMs,
    restanteSeg: Math.ceil(restanteMs / 1000),
  }, 200, origin);
}

/**
 * POST /webhook/mercadopago
 * Recebe notificações do Mercado Pago e libera acesso no KV.
 */
async function webhookMercadoPago(request, env, origin) {
  const body = await request.json().catch(() => null);

  // Mercado Pago envia type=payment para notificações de pagamento
  if (!body || body.type !== "payment") {
    return jsonResponse({ ok: true, ignorado: true }, 200, origin);
  }

  const pagamentoID = body.data?.id;
  if (!pagamentoID) {
    return errorResponse("ID de pagamento ausente no webhook", 400, origin);
  }

  // Consulta o pagamento diretamente na API do MP para validar
  const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${pagamentoID}`, {
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
  });

  if (!mpResponse.ok) {
    return errorResponse("Falha ao consultar pagamento no Mercado Pago", 502, origin);
  }

  const pagamento = await mpResponse.json();

  // Só processa se o pagamento estiver aprovado
  if (pagamento.status !== "approved") {
    return jsonResponse({ ok: true, status: pagamento.status, processado: false }, 200, origin);
  }

  // Extrai userID e plano do external_reference
  const partes = (pagamento.external_reference || "").split("|");
  const userID = partes[0];
  const plano  = partes[1];

  if (!userID || !PLANOS[plano]) {
    return errorResponse("external_reference inválido", 400, origin);
  }

  const duracaoDias = PLANOS[plano].dias;
  const expiraEm   = Date.now() + duracaoDias * 24 * 60 * 60 * 1000;

  await env.KV.put(
    `acesso:${userID}`,
    JSON.stringify({
      userID,
      plano,
      motivo: "pagamento",
      pagamentoID,
      liberadoEm: Date.now(),
      expiraEm,
    }),
    { expirationTtl: duracaoDias * 24 * 60 * 60 + 3600 }
  );

  // Gera token de acesso para scripts externos
  const token = btoa(`${userID}:${expiraEm}:${pagamentoID}`);
  await env.KV.put(`token:${userID}`, token, { expirationTtl: duracaoDias * 24 * 60 * 60 + 3600 });

  return jsonResponse({ ok: true, processado: true, userID, plano }, 200, origin);
}

/**
 * GET /validar-token
 * Header: X-User-ID
 * Valida se o usuário tem acesso ativo — usado por scripts externos como gateway.
 */
async function validarToken(request, env, origin) {
  const userID = getUserID(request);
  if (!userID) return errorResponse("X-User-ID ausente ou inválido", 401, origin);

  const acesso = await env.KV.get(`acesso:${userID}`, "json");
  if (!acesso || acesso.expiraEm <= Date.now()) {
    return errorResponse("Acesso negado ou expirado", 403, origin);
  }

  return jsonResponse({
    ok: true,
    autorizado: true,
    plano: acesso.plano,
    expiraEm: acesso.expiraEm,
  }, 200, origin);
}

// ─── Utilitários internos ────────────────────────────────────────────────────

async function liberarAcessoPorTimer(userID, env) {
  const TIMER_ACESSO_HORAS = 1; // acesso concedido pelo timer: 1 hora
  const expiraEm = Date.now() + TIMER_ACESSO_HORAS * 60 * 60 * 1000;

  await env.KV.put(
    `acesso:${userID}`,
    JSON.stringify({
      userID,
      plano: "timer",
      motivo: "timer",
      liberadoEm: Date.now(),
      expiraEm,
    }),
    { expirationTtl: TIMER_ACESSO_HORAS * 3600 + 300 }
  );
}
