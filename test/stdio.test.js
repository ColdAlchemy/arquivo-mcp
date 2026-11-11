import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { criarBancoDeTeste } from "./ajuda.js";

const SERVIDOR = fileURLToPath(new URL("../src/servidor.js", import.meta.url));
const ambienteLimpo = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };

test("processo real via stdio: initialize, tools/list e tools/call", async () => {
  const banco = criarBancoDeTeste();
  const transporte = new StdioClientTransport({ command: process.execPath, args: [SERVIDOR], env: { ...ambienteLimpo, DOCSIA_DB: banco.caminho, DOCSIA_ESPACO_ID: "1" }, stderr: "pipe" });
  const cliente = new Client({ name: "teste-stdio", version: "0.0.0" });
  try {
    await cliente.connect(transporte);
    assert.equal(cliente.getServerVersion().name, "arquivo-mcp");

    const { tools } = await cliente.listTools();
    assert.equal(tools.length, 4);

    const r = await cliente.callTool({ name: "listar_prazos", arguments: { desde: "2027-01-01" } });
    assert.deepEqual(JSON.parse(r.content[0].text).prazos.map((p) => p.data), ["2027-12-31"]);
  } finally {
    await cliente.close();
    banco.limpar();
  }
});

test("sem DOCSIA_DB o processo encerra com mensagem clara", () => {
  const r = spawnSync(process.execPath, [SERVIDOR], { env: ambienteLimpo, encoding: "utf8", timeout: 15000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DOCSIA_DB/);
  assert.equal(r.stdout, ""); // a saída padrão é só do protocolo
});

test("com vários espaços, exige DOCSIA_ESPACO_ID e lista as opções", () => {
  const banco = criarBancoDeTeste();
  try {
    const r = spawnSync(process.execPath, [SERVIDOR], { env: { ...ambienteLimpo, DOCSIA_DB: banco.caminho }, encoding: "utf8", timeout: 15000 });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /DOCSIA_ESPACO_ID/);
    assert.match(r.stderr, /Escritório A/);
    assert.match(r.stderr, /Escritório B/);
  } finally {
    banco.limpar();
  }
});

test("espaço inexistente e banco inexistente são recusados", () => {
  const banco = criarBancoDeTeste();
  try {
    const a = spawnSync(process.execPath, [SERVIDOR], { env: { ...ambienteLimpo, DOCSIA_DB: banco.caminho, DOCSIA_ESPACO_ID: "99" }, encoding: "utf8", timeout: 15000 });
    assert.equal(a.status, 1);
    assert.match(a.stderr, /não existe/);

    const b = spawnSync(process.execPath, [SERVIDOR], { env: { ...ambienteLimpo, DOCSIA_DB: "C:\\nao\\existe.sqlite" }, encoding: "utf8", timeout: 15000 });
    assert.equal(b.status, 1);
    assert.match(b.stderr, /somente leitura/);
  } finally {
    banco.limpar();
  }
});
