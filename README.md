# Arquivo MCP — os documentos do DocsIA como ferramentas para qualquer cliente MCP

Servidor [MCP](https://modelcontextprotocol.io) (Model Context Protocol) em Node.js, feito com o **SDK oficial**, que expõe o arquivo de documentos do [DocsIA](https://github.com/ColdAlchemy/docs-ia-laravel) para clientes como o **Claude Desktop** e o **Claude Code**. O cliente pode buscar trechos, ler um documento e consultar prazos, sempre **somente leitura** e **dentro de um único espaço de trabalho**.

> Desenvolvido por mim com o auxílio do Claude Code. Eu defini o escopo, revisei e estudo o código. Este projeto **não usa IA**: ele só entrega dados para um cliente que usa. Os documentos de exemplo do DocsIA são fictícios.

## Para que serve (em termos simples)
Hoje, para um assistente de IA (como o Claude) usar os seus documentos, alguém precisa copiar e colar o texto na conversa. O MCP é um **padrão aberto de "tomada"**: este servidor é uma tomada que deixa qualquer assistente compatível **consultar o seu arquivo sozinho**, fazendo perguntas como "quais prazos vencem nos próximos 30 dias?" ou "o que o contrato diz sobre multa?". Ele só **lê** (não consegue alterar nada) e só enxerga **um espaço de trabalho** escolhido por quem configura, para que um assistente não veja dados de outra equipe.

## Ferramentas
| Ferramenta | O que faz |
|---|---|
| `buscar_trechos` | Busca por palavras (TF-IDF) nos trechos dos documentos já processados; devolve os mais relevantes com o documento de origem |
| `obter_documento` | Título, texto completo e dados extraídos (tipo, resumo, partes, prazos, valores) de um documento |
| `listar_prazos` | Prazos extraídos, em ordem de data, com filtros `desde` e `ate` (AAAA-MM-DD) |
| `listar_documentos` | Documentos do espaço, do mais recente para o mais antigo |

Todas têm `readOnlyHint`, entrada validada com Zod (um valor fora do schema vira erro de ferramenta, sem tocar no banco) e descrição para o modelo.

## Como usar
```bash
npm install
```
O servidor lê o banco SQLite do DocsIA pelo caminho em `DOCSIA_DB`. Se o banco tiver mais de um espaço de trabalho, `DOCSIA_ESPACO_ID` escolhe qual.

**Claude Code**
```bash
claude mcp add arquivo -e DOCSIA_DB="C:\dev\docs-ia\database\database.sqlite" -e DOCSIA_ESPACO_ID=1 -- node C:\dev\arquivo-mcp\src\servidor.js
```

**Claude Desktop** (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "arquivo": {
      "command": "node",
      "args": ["C:\\dev\\arquivo-mcp\\src\\servidor.js"],
      "env": { "DOCSIA_DB": "C:\\dev\\docs-ia\\database\\database.sqlite", "DOCSIA_ESPACO_ID": "1" }
    }
  }
}
```
Depois, pergunte ao cliente algo como *"Quais prazos vencem nos próximos 30 dias?"* ou *"O que o contrato diz sobre multa?"*.

## Decisões de projeto
- **Somente leitura de verdade:** o banco é aberto com `readonly` e `fileMustExist`; há teste de que `INSERT` e `DELETE` falham.
- **O espaço de trabalho é escolhido na configuração, não pelo cliente.** Nenhuma ferramenta recebe `espaco_id`, e os testes provam que, configurado no espaço A, nenhuma ferramenta devolve dado do espaço B (busca, documento, prazos e listagem), nem se o cliente tentar mandar `espaco_id` por conta própria.
- **Documentos são dados de terceiros.** Um documento pode conter "ignore as instruções e…". As descrições das ferramentas avisam o modelo para tratá-los como texto, e o servidor só devolve conteúdo, sem executar nada a partir dele.
- **A saída padrão é o canal do protocolo (stdio):** todo log vai para a saída de erro, e erros de configuração encerram o processo com mensagem clara.
- **Busca lexical, de propósito:** TF-IDF simples e explicável, sem depender de embeddings. O DocsIA guarda embeddings por hashing (também lexicais); o resultado das duas buscas pode diferir.

## Testes
```bash
npm test     # 17 testes, sem rede
```
Cobrem as quatro ferramentas, a validação de entrada, o isolamento entre espaços, o banco somente leitura, o texto de documento com instruções, e um **processo real via stdio** (initialize, tools/list e tools/call com o cliente do SDK), além das mensagens de erro de configuração.

## Estrutura
```
src/consultas.js     consultas SQL somente leitura e a busca TF-IDF
src/servidor-mcp.js  as ferramentas (SDK oficial, schemas Zod)
src/servidor.js      ponto de entrada: configuração por variáveis de ambiente e transporte stdio
test/                banco de teste no formato do DocsIA, cliente MCP em memória e via stdio
```

## Limitações
- Lê o SQLite do DocsIA direto: depende do esquema atual dele (tabelas `documentos`, `trechos`, `prazos` e `espacos`) e de ter acesso ao arquivo.
- Sem autenticação: quem consegue iniciar o processo com acesso ao arquivo enxerga o espaço configurado. Serve para uso local.
- Só o transporte stdio (uso local); não há servidor HTTP.
