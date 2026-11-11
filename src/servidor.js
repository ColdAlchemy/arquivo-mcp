#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { abrirBanco, listarEspacos } from "./consultas.js";
import { criarServidorMcp } from "./servidor-mcp.js";

// No transporte stdio, a saída padrão é o canal do protocolo: tudo que for log vai para a saída de erro.
const log = (...partes) => console.error("[arquivo-mcp]", ...partes);

function falhar(mensagem) {
  log(mensagem);
  process.exit(1);
}

const caminhoDb = process.env.DOCSIA_DB;
if (!caminhoDb) falhar("Defina DOCSIA_DB com o caminho do banco SQLite do DocsIA (ex.: C:\\dev\\docs-ia\\database\\database.sqlite).");

let db;
try {
  db = abrirBanco(caminhoDb);
} catch (e) {
  falhar(`Não consegui abrir o banco "${caminhoDb}" em somente leitura: ${e.message}`);
}

const espacos = listarEspacos(db);
let espacoId = process.env.DOCSIA_ESPACO_ID ? Number(process.env.DOCSIA_ESPACO_ID) : null;
if (espacoId === null) {
  if (espacos.length !== 1) falhar(`Há ${espacos.length} espaços de trabalho no banco. Defina DOCSIA_ESPACO_ID com um destes: ${espacos.map((e) => `${e.id} (${e.nome})`).join(", ")}.`);
  espacoId = espacos[0].id;
}
const espaco = espacos.find((e) => e.id === espacoId);
if (!espaco) falhar(`O espaço ${espacoId} não existe. Opções: ${espacos.map((e) => `${e.id} (${e.nome})`).join(", ")}.`);

const servidor = criarServidorMcp({ db, espacoId });
await servidor.connect(new StdioServerTransport());
log(`pronto: espaço "${espaco.nome}" (id ${espacoId}), somente leitura.`);
