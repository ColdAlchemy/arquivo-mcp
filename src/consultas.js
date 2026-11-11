import Database from "better-sqlite3";

/**
 * Consultas somente leitura ao banco do DocsIA (SQLite).
 * Todas recebem o id do espaço de trabalho configurado no servidor: nenhuma ferramenta aceita
 * "espaco_id" do cliente, então um cliente MCP não consegue sair do espaço escolhido.
 */

const PARADAS = new Set([
  "a", "o", "as", "os", "um", "uma", "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas",
  "e", "ou", "que", "com", "por", "para", "ao", "aos", "se", "sua", "seu", "qual", "quais", "foi", "ser", "sao",
]);

/** Minúsculas, sem acento, só palavras com 3+ letras e fora das palavras comuns. */
export function termos(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !PARADAS.has(t));
}

export function abrirBanco(caminho) {
  // readonly + fileMustExist: o servidor nunca cria nem altera o banco do DocsIA.
  return new Database(caminho, { readonly: true, fileMustExist: true });
}

export function listarEspacos(db) {
  return db.prepare("SELECT id, nome FROM espacos ORDER BY id").all();
}

export function listarDocumentos(db, espacoId, { limite = 20 } = {}) {
  return db
    .prepare(
      `SELECT id, numero, titulo, status, json_extract(dados, '$.tipo') AS tipo, created_at
         FROM documentos WHERE espaco_id = ? ORDER BY numero DESC LIMIT ?`,
    )
    .all(espacoId, limite);
}

/**
 * Busca lexical (TF-IDF simplificado) nos trechos dos documentos prontos do espaço.
 * É deliberadamente simples e explicável; o DocsIA, por sua vez, guarda embeddings por hashing.
 */
export function buscarTrechos(db, espacoId, consulta, limite = 5) {
  const consultaTermos = [...new Set(termos(consulta))];
  if (consultaTermos.length === 0) return [];

  const trechos = db
    .prepare(
      `SELECT t.id AS trecho_id, t.documento_id, t.texto, d.titulo, d.numero
         FROM trechos t JOIN documentos d ON d.id = t.documento_id
        WHERE d.espaco_id = ? AND d.status = 'pronto'`,
    )
    .all(espacoId);
  if (trechos.length === 0) return [];

  const lista = trechos.map((t) => ({ ...t, contagem: contar(termos(t.texto)) }));
  const total = lista.length;
  const idf = Object.fromEntries(
    consultaTermos.map((termo) => {
      const df = lista.filter((t) => t.contagem.has(termo)).length;
      return [termo, Math.log(1 + (total - df + 0.5) / (df + 0.5))];
    }),
  );

  return lista
    .map((t) => {
      const tamanho = [...t.contagem.values()].reduce((s, n) => s + n, 0) || 1;
      const pontos = consultaTermos.reduce((s, termo) => s + ((t.contagem.get(termo) ?? 0) / Math.sqrt(tamanho)) * idf[termo], 0);
      return { trecho_id: t.trecho_id, documento_id: t.documento_id, documento: t.titulo, registro: registro(t.numero), texto: t.texto, pontuacao: Number(pontos.toFixed(4)) };
    })
    .filter((t) => t.pontuacao > 0)
    .sort((a, b) => b.pontuacao - a.pontuacao || a.trecho_id - b.trecho_id)
    .slice(0, limite);
}

function contar(lista) {
  const mapa = new Map();
  for (const t of lista) mapa.set(t, (mapa.get(t) ?? 0) + 1);
  return mapa;
}

const registro = (numero) => String(numero).padStart(4, "0");

/** Documento completo (texto e dados extraídos) ou null se não existir NESTE espaço. */
export function obterDocumento(db, espacoId, id) {
  const d = db.prepare("SELECT id, numero, titulo, status, conteudo, dados, created_at FROM documentos WHERE id = ? AND espaco_id = ?").get(id, espacoId);
  if (!d) return null;
  return {
    id: d.id,
    registro: registro(d.numero),
    titulo: d.titulo,
    status: d.status,
    dados_extraidos: d.dados ? JSON.parse(d.dados) : null,
    conteudo: d.conteudo,
  };
}

/** Prazos do espaço em ordem de data; `desde` e `ate` (AAAA-MM-DD) são opcionais e inclusivos. */
export function listarPrazos(db, espacoId, { desde, ate } = {}) {
  const filtros = ["p.espaco_id = ?"];
  const params = [espacoId];
  if (desde) { filtros.push("substr(p.data, 1, 10) >= ?"); params.push(desde); }
  if (ate) { filtros.push("substr(p.data, 1, 10) <= ?"); params.push(ate); }
  return db
    .prepare(
      `SELECT p.id, substr(p.data, 1, 10) AS data, p.descricao, d.id AS documento_id, d.titulo AS documento
         FROM prazos p JOIN documentos d ON d.id = p.documento_id
        WHERE ${filtros.join(" AND ")} ORDER BY p.data, p.id`,
    )
    .all(...params);
}
