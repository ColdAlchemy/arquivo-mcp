import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { abrirBanco } from "../src/consultas.js";
import { criarServidorMcp } from "../src/servidor-mcp.js";

// Esquema mínimo do DocsIA (só as colunas que o servidor lê).
const ESQUEMA = `
CREATE TABLE espacos (id INTEGER PRIMARY KEY, nome TEXT);
CREATE TABLE documentos (id INTEGER PRIMARY KEY, espaco_id INTEGER, numero INTEGER, titulo TEXT, conteudo TEXT, status TEXT, dados TEXT, created_at TEXT);
CREATE TABLE trechos (id INTEGER PRIMARY KEY, documento_id INTEGER, ordem INTEGER, texto TEXT);
CREATE TABLE prazos (id INTEGER PRIMARY KEY, espaco_id INTEGER, documento_id INTEGER, data TEXT, descricao TEXT);
`;

/** Cria um banco SQLite temporário no formato do DocsIA, com dois espaços de trabalho. */
export function criarBancoDeTeste() {
  const pasta = mkdtempSync(join(tmpdir(), "arquivo-mcp-"));
  const caminho = join(pasta, "docsia.sqlite");
  const db = new Database(caminho);
  db.exec(ESQUEMA);

  db.prepare("INSERT INTO espacos VALUES (1, 'Escritório A'), (2, 'Escritório B')").run();

  const doc = db.prepare("INSERT INTO documentos VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const trecho = db.prepare("INSERT INTO trechos (documento_id, ordem, texto) VALUES (?, ?, ?)");
  const prazo = db.prepare("INSERT INTO prazos (espaco_id, documento_id, data, descricao) VALUES (?, ?, ?, ?)");

  // Espaço A
  const contrato = "Contrato de prestação de serviços.\n\nO pagamento mensal de R$ 1.500,00 deve ocorrer até 10/12/2026.\n\nO atraso gera multa de R$ 150,00.";
  doc.run(1, 1, 1, "Contrato de serviços", contrato, "pronto", JSON.stringify({ tipo: "contrato", resumo: "Contrato mensal", partes: ["Maria", "Tech"], prazos: [], valores: [] }), "2026-10-01");
  trecho.run(1, 0, "Contrato de prestação de serviços.");
  trecho.run(1, 1, "O pagamento mensal de R$ 1.500,00 deve ocorrer até 10/12/2026.");
  trecho.run(1, 2, "O atraso gera multa de R$ 150,00.");
  prazo.run(1, 1, "2026-12-10 00:00:00", "Pagamento mensal");
  prazo.run(1, 1, "2027-12-31 00:00:00", "Fim da vigência");

  doc.run(2, 1, 2, "Política de férias", "As férias devem ser solicitadas com 30 dias de antecedência.", "pronto", null, "2026-10-02");
  trecho.run(2, 0, "As férias devem ser solicitadas com 30 dias de antecedência.");

  doc.run(3, 1, 3, "Documento ainda na fila", "Pagamento pagamento pagamento", "pendente", null, "2026-10-03");
  trecho.run(3, 0, "Pagamento pagamento pagamento");

  // Espaço B (confidencial: nunca pode aparecer para o servidor configurado no espaço A)
  doc.run(4, 2, 1, "Cofre do escritório B", "A senha do cofre é abacaxi azul e o pagamento vence em 05/01/2027.", "pronto", null, "2026-10-04");
  trecho.run(4, 0, "A senha do cofre é abacaxi azul e o pagamento vence em 05/01/2027.");
  prazo.run(2, 4, "2027-01-05 00:00:00", "Vencimento do pagamento do escritório B");

  db.close();
  return { caminho, limpar: () => rmSync(pasta, { recursive: true, force: true }) };
}

/** Conecta um cliente MCP ao servidor, em memória, para o espaço pedido (padrão: A). */
export async function conectar({ espacoId = 1 } = {}) {
  const banco = criarBancoDeTeste();
  const db = abrirBanco(banco.caminho);
  const servidor = criarServidorMcp({ db, espacoId });
  const [transporteCliente, transporteServidor] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({ name: "teste", version: "0.0.0" });
  await Promise.all([servidor.connect(transporteServidor), cliente.connect(transporteCliente)]);

  /** Chama uma ferramenta e devolve { erro, dados, texto }. */
  const chamar = async (nome, argumentos = {}) => {
    const r = await cliente.callTool({ name: nome, arguments: argumentos });
    const texto = r.content?.[0]?.text ?? "";
    let dados = null;
    try { dados = JSON.parse(texto); } catch { /* resposta em texto puro (erro) */ }
    return { erro: Boolean(r.isError), dados, texto };
  };

  return {
    cliente, chamar, db, caminho: banco.caminho,
    fechar: async () => { await cliente.close(); await servidor.close(); db.close(); banco.limpar(); },
  };
}
