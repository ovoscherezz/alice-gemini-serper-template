
const DEFAULT_MODEL = "gemini-2.5-flash-lite";

const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_MESSAGE_CHARS = 1200;
const MAX_ALICE_TEXT = 1024;

const TOTAL_RESPONSE_BUDGET_MS = 4200;
const SERPER_TIMEOUT_MS = 400;
const GEMINI_TIMEOUT_MS = 3500;

const FISH_VOICE_ID = "c47719f52ce34cc193b9bc2f00565e8a";
const FISH_MODEL = "s2.1-pro-free";

const FISH_TIMEOUT_MS = 3000;
const YANDEX_TIMEOUT_MS = 900;

const DIAGNOSTIC_FISH_TIMEOUT_MS = 25000;
const DIAGNOSTIC_YANDEX_TIMEOUT_MS = 12000;

const JARVIS_AUDIO_ID =
  "df9659fd-b6ef-4455-b2ea-e6546088a040";

const TEST_PHRASE =
  "Сэр, голосовой модуль Джарвиса подключён. " +
  "Все системы готовы к дальнейшим испытаниям.";

const FISH_CHECK_PHRASE =
  "Сэр, бесплатный голосовой модуль Джарвиса проходит проверку.";

const TTS_EFFECT =
  process.env.JARVIS_TTS_EFFECT === "pitch_down"
    ? "pitch_down"
    : "";

const SYSTEM_PROMPT = [
  "Ты — Джарвис, персональный интеллектуальный голосовой помощник.",
  "Твой характер — спокойный, уверенный, интеллигентный, с лёгкой уместной иронией.",
  "Обращайся к пользователю на вы. Говори о себе в мужском роде.",
  "Отвечай естественно, по-русски, кратко и так, чтобы ответ было удобно слушать.",
  "Обычно используй 1–3 коротких предложения. Не используй Markdown, таблицы и длинные вступления.",
  "Не начинай каждый ответ с приветствия. Не называй себя Алисой или Gemini.",
  "Если вопрос требует актуальных данных и переданы результаты поиска, опирайся на них.",
  "Если не знаешь ответа, честно скажи об этом."
].join(" ");

function fitAliceText(value) {
  const text = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (text.length <= MAX_ALICE_TEXT) {
    return text || "Не удалось подготовить ответ.";
  }

  const candidate = text.slice(0, MAX_ALICE_TEXT - 1);

  const sentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? ")
  );

  if (sentenceEnd >= 300) {
    return candidate.slice(0, sentenceEnd + 1).trim();
  }

  const lastSpace = candidate.lastIndexOf(" ");

  return (
    lastSpace > 200
      ? candidate.slice(0, lastSpace)
      : candidate
  ).trim() + "…";
}

function aliceResponse(text, endSession = false, history = []) {
  const answer = fitAliceText(text);

  const response = {
    text: answer,
    end_session: endSession
  };

  if (TTS_EFFECT) {
    const escaped = answer
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    response.tts =
      `<speaker effect="${TTS_EFFECT}">${escaped}`;
  }

  return {
    version: "1.0",
    response,
    session_state: { history }
  };
}

function audioResponse(text, skillId, audioId, history = []) {
  const result = aliceResponse(text, false, history);

  if (skillId && audioId) {
    result.response.tts =
      `<speaker audio="dialogs-upload/${skillId}/${audioId}.opus">`;
  }

  return result;
}

function jarvisVoiceTest(skillId, history = []) {
  return audioResponse(
    "Добрый вечер, сэр. Все системы работают в штатном режиме. Чем могу быть полезен?",
    skillId,
    JARVIS_AUDIO_ID,
    history
  );
}

function isVoiceTestCommand(text) {
  return /^(джарвис[\s,.!]*)?проверка голоса[.!?]*$/i.test(
    String(text || "").trim()
  );
}

function isConnectionTestCommand(text) {
  return /^(джарвис[\s,.!]*)?проверка подключения[.!?]*$/i.test(
    String(text || "").trim()
  );
}

function isFishTestCommand(text) {
  return /^(джарвис[\s,.!]*)?создай тестовый голос[.!?]*$/i.test(
    String(text || "").trim()
  );
}

function isFishConnectionTestCommand(text) {
  return /^(джарвис[\s,.!]*)?проверка (fish audio|фиш аудио)[.!?]*$/i.test(
    String(text || "").trim()
  );
}

function isSearchIntent(text) {
  return /\b(latest|today|current|news|weather|price|exchange rate|recent|search|look up)\b|сегодня|сейчас|последн|новост|погод|курс валют|найди|поищи|актуальн|сколько стоит|свежие данные/i.test(text);
}

function safeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter(
      item =>
        item &&
        (item.role === "user" || item.role === "model") &&
        typeof item.text === "string"
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map(item => ({
      role: item.role,
      text: item.text.slice(0, MAX_HISTORY_MESSAGE_CHARS)
    }));
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    Math.max(100, timeoutMs)
  );

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));

    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

async function checkYandexConnection(timeoutMs) {
  const token = process.env.YANDEX_OAUTH_TOKEN;

  if (!token) {
    throw new Error("MISSING_YANDEX_TOKEN");
  }

  const { response, data } = await fetchJson(
    "https://dialogs.yandex.net/api/v1/status",
    {
      method: "GET",
      headers: {
        Authorization: `OAuth ${token}`
      }
    },
    timeoutMs
  );

  if (!response.ok) {
    console.warn("Yandex status HTTP:", response.status);

    if (response.status === 401 || response.status === 403) {
      throw new Error("YANDEX_AUTH_FAILED");
    }

    throw new Error("YANDEX_API_FAILED");
  }

  return data;
}

async function generateFishAudio(text, timeoutMs) {
  const key = process.env.FISH_API_KEY;

  if (!key) {
    throw new Error("MISSING_FISH_KEY");
  }

  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    Math.max(100, timeoutMs)
  );

  const startedAt = Date.now();

  try {
    console.log("Fish model:", FISH_MODEL);
    console.log("Fish voice ID:", FISH_VOICE_ID);

    const response = await fetch(
      "https://api.fish.audio/v1/tts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          model: FISH_MODEL
        },
        body: JSON.stringify({
          text,
          reference_id: FISH_VOICE_ID,
          format: "mp3"
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      console.warn("Fish Audio HTTP:", response.status);

      const errorBody = await response
        .text()
        .catch(() => "");

      console.warn(
        "Fish error details:",
        errorBody.slice(0, 300)
      );

      if (response.status === 401 || response.status === 403) {
        throw new Error("FISH_AUTH_FAILED");
      }

      if (response.status === 402) {
        throw new Error("FISH_PAYMENT_REQUIRED");
      }

      if (response.status === 404) {
        throw new Error("FISH_MODEL_NOT_FOUND");
      }

      if (response.status === 422) {
        throw new Error("FISH_INVALID_REQUEST");
      }

      if (response.status === 429) {
        throw new Error("FISH_RATE_LIMIT");
      }

      throw new Error("FISH_API_FAILED");
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (
      contentType.includes("application/json") ||
      contentType.includes("text/html")
    ) {
      throw new Error("FISH_INVALID_AUDIO");
    }

    const audio = await response.arrayBuffer();

    if (audio.byteLength < 1000) {
      throw new Error("FISH_INVALID_AUDIO");
    }

    if (audio.byteLength > 5 * 1024 * 1024) {
      throw new Error("FISH_AUDIO_TOO_LARGE");
    }

    console.log(
      "Fish audio generated successfully. Bytes:",
      audio.byteLength,
      "Duration ms:",
      Date.now() - startedAt
    );

    return audio;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadYandexSound(
  skillId,
  audioBuffer,
  timeoutMs
) {
  const token = process.env.YANDEX_OAUTH_TOKEN;

  if (!token) {
    throw new Error("MISSING_YANDEX_TOKEN");
  }

  if (!skillId) {
    throw new Error("MISSING_SKILL_ID");
  }

  const form = new FormData();

  form.append(
    "file",
    new Blob([audioBuffer], { type: "audio/mpeg" }),
    "jarvis-test.mp3"
  );

  const { response, data } = await fetchJson(
    `https://dialogs.yandex.net/api/v1/skills/${encodeURIComponent(skillId)}/sounds`,
    {
      method: "POST",
      headers: {
        Authorization: `OAuth ${token}`
      },
      body: form
    },
    timeoutMs
  );

  if (!response.ok) {
    console.warn("Yandex upload HTTP:", response.status);

    if (response.status === 401 || response.status === 403) {
      throw new Error("YANDEX_AUTH_FAILED");
    }

    throw new Error("YANDEX_UPLOAD_FAILED");
  }

  const sound = data?.sound;

  if (!sound?.id) {
    throw new Error("YANDEX_NO_SOUND_ID");
  }

  console.log("Yandex uploaded sound ID:", sound.id);
  console.log("Yandex processed:", sound.isProcessed);

  return sound;
}

async function getYandexSound(
  skillId,
  soundId,
  timeoutMs
) {
  const token = process.env.YANDEX_OAUTH_TOKEN;

  if (!token) {
    throw new Error("MISSING_YANDEX_TOKEN");
  }

  if (!skillId || !soundId) {
    throw new Error("MISSING_SOUND_ID");
  }

  const { response, data } = await fetchJson(
    `https://dialogs.yandex.net/api/v1/skills/${encodeURIComponent(skillId)}/sounds/${encodeURIComponent(soundId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `OAuth ${token}`
      }
    },
    timeoutMs
  );

  if (!response.ok) {
    console.warn(
      "Yandex sound status HTTP:",
      response.status
    );

    throw new Error("YANDEX_SOUND_STATUS_FAILED");
  }

  return data?.sound || null;
}

// Защищённый диагностический режим.
// Секрет передаётся в заголовке, не в адресе страницы.
function diagnosticAuthorized(req) {
  const expected = process.env.JARVIS_DIAGNOSTIC_TOKEN;

  if (!expected || expected.length < 20) {
    return false;
  }

  const supplied =
    req.headers["x-jarvis-diagnostic-token"];

  if (
    typeof supplied !== "string" ||
    supplied.length !== expected.length
  ) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < expected.length; i++) {
    diff |=
      expected.charCodeAt(i) ^
      supplied.charCodeAt(i);
  }

  return diff === 0;
}

function diagnosticError(error) {
  if (error?.name === "AbortError") {
    return "TIMEOUT";
  }

  return String(
    error?.message || "UNKNOWN_ERROR"
  ).slice(0, 80);
}

async function handleDiagnostic(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!diagnosticAuthorized(req)) {
    return res.status(401).json({
      ok: false,
      error: "UNAUTHORIZED"
    });
  }

  const body =
    req.body && typeof req.body === "object"
      ? req.body
      : {};

  const action = String(body.action || "");
  const skillId = String(body.skillId || "").trim();

  if (!/^[a-zA-Z0-9-]{10,100}$/.test(skillId)) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_SKILL_ID"
    });
  }

  if (action === "status") {
    const soundId =
      String(body.soundId || "").trim();

    if (!/^[a-zA-Z0-9-]{10,100}$/.test(soundId)) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_SOUND_ID"
      });
    }

    try {
      const sound = await getYandexSound(
        skillId,
        soundId,
        DIAGNOSTIC_YANDEX_TIMEOUT_MS
      );

      return res.status(200).json({
        ok: true,
        action,
        soundId,
        processed: sound?.isProcessed === true,
        sound: sound
          ? {
              id: sound.id,
              isProcessed: sound.isProcessed
            }
          : null
      });
    } catch (error) {
      return res.status(200).json({
        ok: false,
        stage: "yandex_status",
        error: diagnosticError(error)
      });
    }
  }

  if (action !== "generate") {
    return res.status(400).json({
      ok: false,
      error: "INVALID_ACTION"
    });
  }

  let audio;

  try {
    audio = await generateFishAudio(
      TEST_PHRASE,
      DIAGNOSTIC_FISH_TIMEOUT_MS
    );
  } catch (error) {
    return res.status(200).json({
      ok: false,
      stage: "fish",
      error: diagnosticError(error)
    });
  }

  try {
    const sound = await uploadYandexSound(
      skillId,
      audio,
      DIAGNOSTIC_YANDEX_TIMEOUT_MS
    );

    return res.status(200).json({
      ok: true,
      stage: "uploaded",
      soundId: sound.id,
      processed: sound.isProcessed === true,
      audioBytes: audio.byteLength
    });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      stage: "yandex_upload",
      error: diagnosticError(error),
      audioBytes: audio.byteLength
    });
  }
}

async function searchWeb(query, timeoutMs) {
  const key = process.env.SERPER_API_KEY;

  if (!key || timeoutMs < 150) {
    return "";
  }

  try {
    const { response, data } = await fetchJson(
      "https://google.serper.dev/search",
      {
        method: "POST",
        headers: {
          "X-API-KEY": key,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          q: query,
          gl: "ru",
          hl: "ru",
          num: 3
        })
      },
      Math.min(SERPER_TIMEOUT_MS, timeoutMs)
    );

    if (!response.ok) {
      console.warn(
        "Serper HTTP status:",
        response.status
      );

      return "";
    }

    const items = (
      Array.isArray(data.organic) ? data.organic : []
    )
      .slice(0, 3)
      .map((item, i) => {
        const title =
          String(item.title || "").slice(0, 180);

        const snippet =
          String(item.snippet || "").slice(0, 350);

        const link =
          String(item.link || "").slice(0, 240);

        return `${i + 1}. ${title}: ${snippet} ${link}`.trim();
      });

    const answerBox =
      data.answerBox?.answer ||
      data.answerBox?.snippet;

    if (answerBox) {
      items.unshift(
        `Краткий ответ поисковика: ${String(answerBox).slice(0, 350)}`
      );
    }

    return items.join("\n");
  } catch {
    console.warn(
      "Serper timed out or failed; continuing without search."
    );

    return "";
  }
}

async function askGemini(
  text,
  history,
  searchContext,
  timeoutMs
) {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    throw new Error("MISSING_GEMINI_KEY");
  }

  if (timeoutMs < 250) {
    throw new Error("TIME_BUDGET_EXHAUSTED");
  }

  const model = String(
    process.env.GEMINI_MODEL || DEFAULT_MODEL
  ).trim();

  if (!/^[A-Za-z0-9._-]+$/.test(model)) {
    throw new Error("INVALID_MODEL_NAME");
  }

  console.log("Gemini model:", model);

  const contents = safeHistory(history).map(
    item => ({
      role: item.role,
      parts: [{ text: item.text }]
    })
  );

  const prompt = searchContext
    ? `${text}\n\nРезультаты поиска в интернете:\n${searchContext}\nИспользуй их только там, где они относятся к вопросу.`
    : text;

  contents.push({
    role: "user",
    parts: [{ text: prompt }]
  });

  const generationConfig = {
    temperature: 0.4,
    maxOutputTokens: 512
  };

  const thinkingLevel = String(
    process.env.GEMINI_THINKING_LEVEL || "low"
  ).toLowerCase();

  if (
    /^gemini-3(?:[.-]|$)/.test(model) &&
    ["minimal", "low", "medium", "high"].includes(
      thinkingLevel
    )
  ) {
    generationConfig.thinkingConfig = {
      thinkingLevel
    };
  }

  const startedAt = Date.now();
  let result;

  try {
    result = await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents,
          generationConfig
        })
      },
      Math.min(GEMINI_TIMEOUT_MS, timeoutMs)
    );
  } finally {
    console.log(
      "Gemini request duration ms:",
      Date.now() - startedAt
    );
  }

  const { response, data } = result;

  if (!response.ok) {
    const status = Number(response.status);
    const googleError = data?.error || {};

    console.error("Gemini HTTP status:", status);
    console.error("Gemini model used:", model);

    console.error(
      "Gemini error details:",
      JSON.stringify({
        code: googleError.code,
        status: googleError.status,
        message: String(
          googleError.message || ""
        ).slice(0, 1000)
      })
    );

    if (status === 401 || status === 403) {
      throw new Error("GEMINI_KEY_REJECTED");
    }

    if (status === 429) {
      throw new Error("GEMINI_QUOTA");
    }

    if (status === 404) {
      throw new Error("GEMINI_MODEL_NOT_FOUND");
    }

    throw new Error("GEMINI_REQUEST_FAILED");
  }

  const candidate = data?.candidates?.[0];

  const answer = (candidate?.content?.parts || [])
    .map(part =>
      typeof part.text === "string"
        ? part.text
        : ""
    )
    .join("")
    .trim();

  if (!answer) {
    if (data?.promptFeedback?.blockReason) {
      throw new Error("GEMINI_BLOCKED");
    }

    throw new Error("GEMINI_EMPTY_RESPONSE");
  }

  if (candidate?.finishReason === "MAX_TOKENS") {
    console.warn(
      "Gemini reached the output token limit."
    );
  }

  return answer;
}

function errorForUser(error) {
  switch (error?.message) {
    case "MISSING_GEMINI_KEY":
      return "Сервер пока не настроен. Проверьте ключ Gemini в Vercel.";

    case "GEMINI_KEY_REJECTED":
      return "Не удалось подключиться к Gemini. Проверьте API-ключ.";

    case "GEMINI_QUOTA":
      return "Сейчас превышен лимит запросов к Gemini. Попробуйте позже.";

    case "GEMINI_MODEL_NOT_FOUND":
      return "Выбранная модель Gemini недоступна. Проверьте настройки модели.";

    case "GEMINI_BLOCKED":
      return "Я не смог обработать этот запрос. Попробуйте спросить иначе.";

    case "TIME_BUDGET_EXHAUSTED":
    case "AbortError":
      return "Не успел подготовить ответ. Попробуйте задать вопрос ещё раз, чуть короче.";

    default:
      return "Не получилось получить ответ от нейросети. Попробуйте ещё раз чуть позже.";
  }
}

function fishErrorForUser(error) {
  switch (error?.message) {
    case "MISSING_FISH_KEY":
      return "Ключ Fish Audio не найден в настройках Vercel.";

    case "MISSING_YANDEX_TOKEN":
      return "OAuth-токен Яндекса не найден в настройках Vercel.";

    case "FISH_AUTH_FAILED":
      return "Fish Audio отклонил API-ключ или доступ к бесплатной модели.";

    case "FISH_PAYMENT_REQUIRED":
      return "Fish Audio по-прежнему требует оплату. Бесплатный режим для этого запроса недоступен.";

    case "FISH_MODEL_NOT_FOUND":
      return "Fish Audio не нашёл бесплатную модель. Возможно, её название или доступ изменились.";

    case "FISH_INVALID_REQUEST":
      return "Fish Audio отклонил параметры запроса. Подробности находятся в журнале Vercel.";

    case "FISH_RATE_LIMIT":
      return "Fish Audio временно ограничил количество запросов.";

    case "YANDEX_AUTH_FAILED":
      return "Яндекс отклонил OAuth-токен или доступ к навыку.";

    case "MISSING_SKILL_ID":
      return "Яндекс не передал идентификатор навыка.";

    case "FISH_AUDIO_TOO_LARGE":
      return "Созданный аудиофайл превышает лимит Яндекса.";

    case "FISH_INVALID_AUDIO":
      return "Fish Audio вернул некорректный аудиофайл.";

    case "YANDEX_UPLOAD_FAILED":
      return "Не удалось загрузить звук в Яндекс Диалоги.";

    case "YANDEX_NO_SOUND_ID":
      return "Яндекс принял запрос, но не вернул идентификатор звука.";

    case "AbortError":
      return "Голосовой сервис не успел ответить за отведённое время.";

    default:
      return "Тест голосового модуля завершился ошибкой. Проверьте журнал Vercel.";
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "alice-gemini-serper",
      fishConfigured: Boolean(process.env.FISH_API_KEY),
      fishModel: FISH_MODEL,
      yandexConfigured: Boolean(
        process.env.YANDEX_OAUTH_TOKEN
      ),
      diagnosticConfigured: Boolean(
        process.env.JARVIS_DIAGNOSTIC_TOKEN
      ),
      message: "Webhook is ready."
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");

    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  // Отдельный диагностический режим.
  // Обычные запросы Алисы не затрагиваются.
  if (
    req.headers["x-jarvis-diagnostic-token"] !==
    undefined
  ) {
    return handleDiagnostic(req, res);
  }

  const startedAt = Date.now();

  const remainingMs = () =>
    TOTAL_RESPONSE_BUDGET_MS -
    (Date.now() - startedAt);

  const body =
    req.body && typeof req.body === "object"
      ? req.body
      : {};

  const text = String(
    body?.request?.command ||
    body?.request?.original_utterance ||
    ""
  ).trim();

  const oldHistory = safeHistory(
    body?.state?.session?.history
  );

  const skillId = String(
    body?.session?.skill_id || ""
  ).trim();

  if (isVoiceTestCommand(text)) {
    console.log(
      "Jarvis audio test: no Gemini request."
    );

    return res.status(200).json(
      jarvisVoiceTest(skillId, oldHistory)
    );
  }

  if (isConnectionTestCommand(text)) {
    try {
      const status = await checkYandexConnection(
        Math.min(2500, remainingMs() - 300)
      );

      console.log(
        "Yandex connection OK. Sound quota:",
        JSON.stringify(
          status?.sounds?.quota || {}
        )
      );

      return res.status(200).json(
        aliceResponse(
          "Подключение к Яндекс Диалогам работает. OAuth-токен принят.",
          false,
          oldHistory
        )
      );
    } catch (error) {
      console.warn(
        "Yandex connection test failed:",
        error?.message || "unknown"
      );

      return res.status(200).json(
        aliceResponse(
          fishErrorForUser(error),
          false,
          oldHistory
        )
      );
    }
  }

  if (isFishConnectionTestCommand(text)) {
    try {
      const audio = await generateFishAudio(
        FISH_CHECK_PHRASE,
        Math.min(
          FISH_TIMEOUT_MS,
          Math.max(100, remainingMs() - 400)
        )
      );

      console.log(
        "Free Fish Audio test succeeded. Bytes:",
        audio.byteLength
      );

      return res.status(200).json(
        aliceResponse(
          "Проверка завершена успешно. Бесплатная модель Fish Audio создала голос Джарвиса. Теперь можно проверить загрузку записи в Яндекс Диалоги.",
          false,
          oldHistory
        )
      );
    } catch (error) {
      console.warn(
        "Free Fish Audio test failed:",
        error?.name === "AbortError"
          ? "AbortError"
          : error?.message || "unknown"
      );

      return res.status(200).json(
        aliceResponse(
          fishErrorForUser(error),
          false,
          oldHistory
        )
      );
    }
  }

  if (isFishTestCommand(text)) {
    try {
      if (!skillId) {
        throw new Error("MISSING_SKILL_ID");
      }

      const audio = await generateFishAudio(
        TEST_PHRASE,
        Math.min(
          FISH_TIMEOUT_MS,
          Math.max(
            100,
            remainingMs() - 1200
          )
        )
      );

      const sound = await uploadYandexSound(
        skillId,
        audio,
        Math.min(
          YANDEX_TIMEOUT_MS,
          Math.max(
            100,
            remainingMs() - 300
          )
        )
      );

      if (sound.isProcessed === true) {
        return res.status(200).json(
          audioResponse(
            TEST_PHRASE,
            skillId,
            sound.id,
            oldHistory
          )
        );
      }

      return res.status(200).json(
        aliceResponse(
          "Fish Audio создал запись, а Яндекс принял её на обработку. Идентификатор записи сохранён в журнале Vercel. Для воспроизведения нужно дождаться обработки.",
          false,
          oldHistory
        )
      );
    } catch (error) {
      console.warn(
        "Fish voice test failed:",
        error?.name === "AbortError"
          ? "AbortError"
          : error?.message || "unknown"
      );

      return res.status(200).json(
        aliceResponse(
          fishErrorForUser(error),
          false,
          oldHistory
        )
      );
    }
  }

  if (!text) {
    return res.status(200).json(
      aliceResponse(
        "Здравствуйте. Я Джарвис, ваш персональный помощник. Чем могу быть полезен?",
        false,
        oldHistory
      )
    );
  }

  try {
    let searchContext = "";

    if (
      isSearchIntent(text) &&
      process.env.SERPER_API_KEY
    ) {
      searchContext = await searchWeb(
        text,
        Math.min(
          SERPER_TIMEOUT_MS,
          Math.max(
            0,
            remainingMs() - 2600
          )
        )
      );
    }

    const answer = await askGemini(
      text,
      oldHistory,
      searchContext,
      Math.max(
        0,
        Math.min(
          GEMINI_TIMEOUT_MS,
          remainingMs() - 600
        )
      )
    );

    const history = [
      ...oldHistory,
      {
        role: "user",
        text: text.slice(
          0,
          MAX_HISTORY_MESSAGE_CHARS
        )
      },
      {
        role: "model",
        text: answer.slice(
          0,
          MAX_HISTORY_MESSAGE_CHARS
        )
      }
    ].slice(-MAX_HISTORY_MESSAGES);

    return res.status(200).json(
      aliceResponse(answer, false, history)
    );
  } catch (error) {
    const safeError =
      error?.name === "AbortError"
        ? new Error("TIME_BUDGET_EXHAUSTED")
        : error;

    console.warn(
      "Alice webhook returned a fallback response:",
      safeError?.message || "unknown error"
    );

    return res.status(200).json(
      aliceResponse(
        errorForUser(safeError),
        false,
        oldHistory
      )
    );
  }
}

export {
  aliceResponse,
  fitAliceText,
  isSearchIntent,
  safeHistory,
  isVoiceTestCommand,
  jarvisVoiceTest,
  isConnectionTestCommand,
  isFishTestCommand,
  isFishConnectionTestCommand
};
