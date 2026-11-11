import { test } from "node:test";
import assert from "node:assert/strict";
import { termos } from "../src/consultas.js";
import { conectar } from "./ajuda.js";

test("lista as quatro ferramentas, todas marcadas como somente leitura", async () => {
  const c = await conectar();
  try {
    const { tools } = await c.cliente.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["buscar_trechos", "listar_documentos", "listar_prazos", "obter_documento"]);
    for (const t of tools) {
      assert.equal(t.annotations?.readOnlyHint, true, `${t.name} deveria ser somente leitura`);
      assert.ok(t.description.length > 20);
      assert.equal(t.inputSchema.type, "object");
    }
    // nenhuma ferramenta aceita escolher o espaço de trabalho
    for (const t of tools) assert.equal("espaco_id" in (t.inputSchema.properties ?? {}), false);
  } finally {
    await c.fechar();
  }
});

test("termos: tira acentos, palavras comuns e palavras curtas", () => {
  assert.deepEqual(termos("Qual é o prazo de pagamento da Multa?"), ["prazo", "pagamento", "multa"]);
  assert.deepEqual(termos("  "), []);
});

test("buscar_trechos ordena por relevância e traz o documento de origem", async () => {
  const c = await conectar();
  try {
    const r = await c.chamar("buscar_trechos", { consulta: "prazo de pagamento mensal" });
    assert.equal(r.erro, false);
    assert.ok(r.dados.total >= 1);
    const primeiro = r.dados.resultados[0];
    assert.match(primeiro.texto, /pagamento mensal/);
    assert.equal(primeiro.documento, "Contrato de serviços");
    assert.equal(primeiro.documento_id, 1);
    assert.equal(primeiro.registro, "0001");
    const pontos = r.dados.resultados.map((x) => x.pontuacao);
    assert.deepEqual(pontos, [...pontos].sort((a, b) => b - a));
  } finally {
    await c.fechar();
  }
});

test("buscar_trechos ignora documentos que ainda não foram processados", async () => {
  const c = await conectar();
  try {
    const r = await c.chamar("buscar_trechos", { consulta: "pagamento" });
    assert.ok(!r.dados.resultados.some((x) => x.documento === "Documento ainda na fila"));
  } finally {
    await c.fechar();
  }
});

test("buscar_trechos: sem resultado, limite e validação da entrada", async () => {
  const c = await conectar();
  try {
    assert.equal((await c.chamar("buscar_trechos", { consulta: "xyzzy qwerty" })).dados.total, 0);
    assert.equal((await c.chamar("buscar_trechos", { consulta: "contrato pagamento multa férias", limite: 1 })).dados.resultados.length, 1);

    // entradas inválidas viram erro de ferramenta (validação do schema), sem chegar ao banco
    for (const entrada of [{}, { consulta: "a" }, { consulta: "ok ok", limite: 0 }, { consulta: "ok ok", limite: 11 }, { consulta: "ok ok", limite: "5" }]) {
      const r = await c.chamar("buscar_trechos", entrada);
      assert.equal(r.erro, true, JSON.stringify(entrada));
    }
  } finally {
    await c.fechar();
  }
});

test("obter_documento devolve texto e dados extraídos; id inexistente vira erro de ferramenta", async () => {
  const c = await conectar();
  try {
    const r = await c.chamar("obter_documento", { documento_id: 1 });
    assert.equal(r.erro, false);
    assert.equal(r.dados.titulo, "Contrato de serviços");
    assert.match(r.dados.conteudo, /R\$ 1\.500,00/);
    assert.equal(r.dados.dados_extraidos.tipo, "contrato");
    assert.equal((await c.chamar("obter_documento", { documento_id: 2 })).dados.dados_extraidos, null);

    const nao = await c.chamar("obter_documento", { documento_id: 999 });
    assert.equal(nao.erro, true);
    assert.match(nao.texto, /não encontrado/);
  } finally {
    await c.fechar();
  }
});

test("listar_prazos em ordem cronológica, com filtros inclusivos", async () => {
  const c = await conectar();
  try {
    const todos = await c.chamar("listar_prazos");
    assert.deepEqual(todos.dados.prazos.map((p) => p.data), ["2026-12-10", "2027-12-31"]);
    assert.equal(todos.dados.prazos[0].documento, "Contrato de serviços");

    assert.deepEqual((await c.chamar("listar_prazos", { desde: "2027-01-01" })).dados.prazos.map((p) => p.data), ["2027-12-31"]);
    assert.deepEqual((await c.chamar("listar_prazos", { ate: "2026-12-10" })).dados.prazos.map((p) => p.data), ["2026-12-10"]);
    assert.equal((await c.chamar("listar_prazos", { desde: "2030-01-01" })).dados.total, 0);
    assert.equal((await c.chamar("listar_prazos", { desde: "amanhã" })).erro, true);
  } finally {
    await c.fechar();
  }
});

test("listar_documentos traz o mais recente primeiro", async () => {
  const c = await conectar();
  try {
    const r = await c.chamar("listar_documentos");
    assert.deepEqual(r.dados.documentos.map((d) => d.titulo), ["Documento ainda na fila", "Política de férias", "Contrato de serviços"]);
    assert.equal(r.dados.documentos[2].tipo, "contrato");
    assert.equal((await c.chamar("listar_documentos", { limite: 1 })).dados.documentos.length, 1);
  } finally {
    await c.fechar();
  }
});
