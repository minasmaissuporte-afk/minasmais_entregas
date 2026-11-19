import { AUTH_FAILURES_PER_10_MIN, RATE_LIMIT_PER_MINUTE } from "./credentials";
import { paymentMethodValues } from "./contract";

/**
 * Documentação OpenAPI 3.1 da integração ERP, servida em /api/v1/erp/openapi.json
 * e visualizada no Swagger em /api/v1/erp/docs.
 */
export function erpOpenApiDocument(serverUrl: string) {
  const error = (codigo: string, mensagem: string, detalhes?: { campo: string; mensagem: string }[]) => ({
    erro: { codigo, mensagem, ...(detalhes ? { detalhes } : {}) },
    requestId: "5d1f2a64-3c3e-4f0f-9a51-1b2c3d4e5f60",
  });
  const errorResponse = (description: string, examples: Record<string, ReturnType<typeof error>>) => ({
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Erro" },
        examples: Object.fromEntries(Object.entries(examples).map(([key, value]) => [key, { value }])),
      },
    },
  });
  const unauthorized = errorResponse("Credencial ausente, inválida ou revogada.", {
    ausente: error("CREDENCIAL_AUSENTE", "Envie o token no cabeçalho Authorization: Bearer <token>."),
    invalida: error("CREDENCIAL_INVALIDA", "Credencial inválida ou revogada."),
  });
  const tooMany = errorResponse("Limite de requisições atingido. Respeite o cabeçalho Retry-After (segundos).", {
    limite: error("LIMITE_REQUISICOES", `Limite de ${RATE_LIMIT_PER_MINUTE} requisições por minuto atingido. Tente de novo em 1 minuto.`),
  });
  const notFound = errorResponse("Venda não encontrada.", {
    naoEncontrada: error("VENDA_NAO_ENCONTRADA", 'Nenhuma entrega com a venda "123456".'),
  });
  const serverError = errorResponse("Erro interno. Pode reenviar a mesma requisição (é idempotente).", {
    interno: error("ERRO_INTERNO", "Erro interno. Tente de novo em instantes."),
  });
  const saleIdParam = {
    in: "path",
    name: "idVenda",
    required: true,
    description: "ID da venda no ERP (o mesmo enviado em `idVenda`).",
    schema: { type: "string", maxLength: 64, pattern: "^[A-Za-z0-9._\\-/]+$" },
    example: "123456",
  };

  const exemploVenda = {
    idVenda: "123456",
    codigoFilial: "001",
    dataVenda: "2026-11-19T10:30:00-03:00",
    cliente: { nome: "Maria da Silva", telefone: "35999998888" },
    endereco: {
      cep: "37500-000",
      rua: "Rua das Flores",
      numero: "120",
      bairro: "Centro",
      cidade: "Itajubá",
      estado: "MG",
      complemento: "Apto 202",
      referencia: "Em frente à praça",
    },
    pedido: {
      numeroPedido: "PED-98765",
      valorTotal: 58.9,
      formaPagamento: "DINHEIRO",
      valorReceber: 66.9,
      trocoPara: 100,
      receita: false,
      observacoes: "Interfone com defeito, ligar ao chegar.",
    },
  };
  const exemploEntrega = {
    idVenda: "123456",
    codigoEntrega: "MM-000231",
    status: "OFFERED",
    situacao: "Aguardando um motoboy aceitar",
    filial: { codigo: "001", nome: "Drogaria Minas Mais Centro" },
    cliente: { nome: "Maria da Silva", telefone: "35999998888" },
    endereco: "Rua das Flores, 120, Apto 202 - Centro, Itajubá - MG, 37500-000",
    numeroPedido: "PED-98765",
    pagamento: {
      formaPagamento: "DINHEIRO",
      pago: false,
      valorProdutos: 58.9,
      taxaEntrega: 8,
      valorCobrarNaEntrega: 66.9,
      trocoPara: 100,
    },
    motoboy: null,
    criadaEm: "2026-11-19T13:30:02.000Z",
    atualizadaEm: "2026-11-19T13:30:02.000Z",
    historico: [
      { data: "2026-11-19T13:30:02.000Z", descricao: "Entrega solicitada pelo ERP (venda 123456)" },
      { data: "2026-11-19T13:30:02.000Z", descricao: "Enviada para os motoboys de Itajubá" },
    ],
  };

  const texto = (maxLength: number, description: string, example?: unknown) => ({
    type: ["string", "null"],
    maxLength,
    description,
    ...(example !== undefined ? { example } : {}),
  });
  const dinheiro = (description: string, example?: number) => ({
    type: ["number", "string", "null"],
    minimum: 0,
    description: `${description} Aceita número (58.9) ou texto ("58,90").`,
    ...(example !== undefined ? { example } : {}),
  });

  return {
    openapi: "3.1.0",
    info: {
      title: "Minas Mais Entregas — Integração ERP",
      version: "1.0.0",
      description: [
        "API para o ERP da Rede Minas Mais enviar automaticamente as vendas para entrega.",
        "",
        "**Fluxo:** venda finalizada no ERP e marcada como entrega → `POST /entregas` → a entrega é cadastrada na filial",
        "do `codigoFilial`, aparece no painel da central e é oferecida aos motoboys da cidade (quem aceitar primeiro leva).",
        "",
        "**Autenticação:** token da integração no cabeçalho `Authorization: Bearer <token>` (ou `X-API-Key: <token>`).",
        "O token é gerado pelo administrador em *Integração ERP* e aparece uma única vez. Nunca coloque o token em URL.",
        "",
        "**Idempotência:** a venda é identificada pelo `idVenda`. Reenviar a mesma venda não cria outra entrega:",
        "a resposta é `200` com `duplicada: true` e os dados da entrega existente (cabeçalho `Idempotent-Replayed: true`).",
        "Vale também para envios simultâneos. Em caso de erro de rede ou `5xx`, reenvie a mesma requisição.",
        "",
        `**Limites:** ${RATE_LIMIT_PER_MINUTE} requisições por minuto por credencial (\`429\` com \`Retry-After\`).`,
        `Depois de ${AUTH_FAILURES_PER_10_MIN} tentativas com token inválido em 10 minutos, o IP fica bloqueado por 10 minutos.`,
        "Corpo de até 64 KB. Somente HTTPS.",
        "",
        "**Erros:** sempre no formato `{ erro: { codigo, mensagem, detalhes? }, requestId }`. Informe o `requestId` ao suporte.",
      ].join("\n"),
    },
    servers: [{ url: serverUrl, description: "Produção" }],
    tags: [
      { name: "Entregas", description: "Envio, consulta, atualização e cancelamento de vendas para entrega" },
      { name: "Monitoramento", description: "Disponibilidade da integração" },
    ],
    security: [{ bearerAuth: [] }],
    paths: {
      "/health": {
        get: {
          tags: ["Monitoramento"],
          summary: "Verificar disponibilidade",
          description: "Não precisa de token. Se o token for enviado, a resposta informa se ele é válido (`credencialValida`).",
          security: [],
          responses: {
            "200": {
              description: "Integração disponível",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Health" },
                  example: { status: "ok", versao: "v1", dataHora: "2026-11-19T13:30:00.000Z", credencialValida: true },
                },
              },
            },
            "503": {
              description: "Integração indisponível no momento",
              content: { "application/json": { example: { status: "indisponivel", versao: "v1", dataHora: "2026-11-19T13:30:00.000Z" } } },
            },
          },
        },
      },
      "/entregas": {
        post: {
          tags: ["Entregas"],
          summary: "Enviar venda para entrega",
          description:
            "Cadastra a entrega na filial do `codigoFilial` e envia para os motoboys. Se a venda já tiver sido recebida, devolve a entrega existente (200, `duplicada: true`).",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Venda" },
                examples: {
                  dinheiro: { summary: "Dinheiro com troco", value: exemploVenda },
                  pago: {
                    summary: "Já pago (motoboy não cobra)",
                    value: {
                      idVenda: "123457",
                      codigoFilial: "001",
                      cliente: { nome: "João Pereira" },
                      endereco: { rua: "Av. Brasil", numero: "45", bairro: "Varginha", cidade: "Itajubá", estado: "MG" },
                      pedido: { valorTotal: 32.5, pago: true },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Entrega cadastrada",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RespostaEntrega" },
                  example: { duplicada: false, mensagem: "Entrega cadastrada e enviada para os motoboys.", entrega: exemploEntrega, requestId: "5d1f2a64-3c3e-4f0f-9a51-1b2c3d4e5f60" },
                },
              },
            },
            "200": {
              description: "Venda já recebida antes (nenhuma entrega nova foi criada)",
              headers: { "Idempotent-Replayed": { schema: { type: "string", example: "true" } } },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RespostaEntrega" },
                  example: { duplicada: true, mensagem: "Esta venda já tinha sido recebida. Nenhuma entrega nova foi criada.", entrega: exemploEntrega, requestId: "5d1f2a64-3c3e-4f0f-9a51-1b2c3d4e5f60" },
                },
              },
            },
            "400": errorResponse("Dados inválidos ou JSON malformado.", {
              dados: error("DADOS_INVALIDOS", "Confira os campos enviados.", [
                { campo: "cliente.nome", mensagem: "obrigatório" },
                { campo: "endereco.rua", mensagem: "obrigatório" },
              ]),
              json: error("JSON_INVALIDO", "O corpo da requisição não é um JSON válido."),
            }),
            "401": unauthorized,
            "422": errorResponse("A venda não pode ser cadastrada (regra de negócio).", {
              filial: error("FILIAL_NAO_CADASTRADA", 'A filial "099" não está vinculada no Sistema de Entregas. Peça ao administrador para cadastrar o código da filial do ERP.'),
              inativa: error("FILIAL_INATIVA", 'A filial "001" está inativa no Sistema de Entregas.'),
              tarifa: error("FILIAL_SEM_TARIFA", 'A filial "001" ainda não tem a taxa de entrega configurada.'),
              pagamento: error("FORMA_PAGAMENTO_OBRIGATORIA", "Informe pedido.formaPagamento (ou pedido.pago = true).", [
                { campo: "pedido.formaPagamento", mensagem: "obrigatório quando o pedido não está pago" },
              ]),
            }),
            "429": tooMany,
            "500": serverError,
          },
        },
      },
      "/entregas/{idVenda}": {
        get: {
          tags: ["Entregas"],
          summary: "Consultar entrega pela venda",
          parameters: [saleIdParam],
          responses: {
            "200": {
              description: "Situação atual da entrega",
              content: { "application/json": { schema: { $ref: "#/components/schemas/RespostaConsulta" }, example: { entrega: exemploEntrega, requestId: "5d1f2a64-3c3e-4f0f-9a51-1b2c3d4e5f60" } } },
            },
            "401": unauthorized,
            "404": notFound,
            "429": tooMany,
          },
        },
        patch: {
          tags: ["Entregas"],
          summary: "Atualizar dados da entrega",
          description: [
            "Envie só o que mudou. Os campos enviados substituem os anteriores.",
            "- `cliente` e `pedido`: atualização parcial (campo a campo).",
            "- `endereco`: se enviado, vem completo e só pode mudar **antes de um motoboy aceitar** (senão `409 ENDERECO_BLOQUEADO`).",
            "- A filial não muda (`409 FILIAL_NAO_ALTERAVEL`): cancele e envie a venda de novo.",
            "- Entrega encerrada (entregue, cancelada) não muda (`409 ENTREGA_ENCERRADA`).",
          ].join("\n"),
          parameters: [saleIdParam],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AtualizacaoVenda" },
                example: { cliente: { telefone: "35988887777" }, pedido: { formaPagamento: "PIX", observacoes: "Cliente pediu para chamar no portão." } },
              },
            },
          },
          responses: {
            "200": {
              description: "Atualizada (ou nada mudou, `alterada: false`)",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RespostaAtualizacao" },
                  example: { alterada: true, mensagem: "Entrega atualizada.", entrega: exemploEntrega, requestId: "5d1f2a64-3c3e-4f0f-9a51-1b2c3d4e5f60" },
                },
              },
            },
            "400": errorResponse("Dados inválidos.", { dados: error("DADOS_INVALIDOS", "Confira os campos enviados.", [{ campo: "pedido.formaPagamento", mensagem: `use um destes valores: ${paymentMethodValues.join(", ")}` }]) }),
            "401": unauthorized,
            "404": notFound,
            "409": errorResponse("A alteração não é permitida na situação atual da entrega.", {
              encerrada: error("ENTREGA_ENCERRADA", "A entrega MM-000231 já foi encerrada (Entregue) e não pode mudar."),
              endereco: error("ENDERECO_BLOQUEADO", "O endereço só pode mudar antes de um motoboy aceitar a entrega. Fale com a central ou cancele e envie de novo."),
              filial: error("FILIAL_NAO_ALTERAVEL", "Não dá para trocar a filial de uma entrega. Cancele a venda e envie de novo com a filial certa."),
            }),
            "429": tooMany,
            "500": serverError,
          },
        },
      },
      "/entregas/{idVenda}/cancelar": {
        post: {
          tags: ["Entregas"],
          summary: "Cancelar entrega",
          description:
            "Cancela a entrega e libera o motoboy (que recebe um aviso). Repetir o cancelamento não dá erro (`jaEstavaCancelada: true`). Entrega já entregue não pode ser cancelada.",
          parameters: [saleIdParam],
          requestBody: {
            required: false,
            content: { "application/json": { schema: { $ref: "#/components/schemas/Cancelamento" }, example: { motivo: "Venda estornada no caixa" } } },
          },
          responses: {
            "200": {
              description: "Cancelada (ou já estava)",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RespostaCancelamento" },
                  example: { jaEstavaCancelada: false, mensagem: "Entrega cancelada.", entrega: { ...exemploEntrega, status: "CANCELLED", situacao: "Cancelada" }, requestId: "5d1f2a64-3c3e-4f0f-9a51-1b2c3d4e5f60" },
                },
              },
            },
            "401": unauthorized,
            "404": notFound,
            "409": errorResponse("Não pode cancelar.", {
              encerrada: error("ENTREGA_ENCERRADA", "A entrega MM-000231 já foi encerrada (Entregue) e não pode ser cancelada."),
              rota: error("ENTREGA_EM_ROTA", "A entrega MM-000231 está numa rota agrupada. A central precisa tirá-la da rota antes de cancelar."),
            }),
            "429": tooMany,
            "500": serverError,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "mmerp_<prefixo>_<segredo>", description: "Token gerado em Integração ERP (painel do administrador)." },
        apiKeyHeader: { type: "apiKey", in: "header", name: "X-API-Key", description: "Alternativa ao Authorization: o mesmo token." },
      },
      schemas: {
        Venda: {
          type: "object",
          required: ["idVenda", "codigoFilial", "cliente", "endereco"],
          properties: {
            idVenda: { type: ["string", "number"], maxLength: 64, description: "ID único da venda no ERP. Letras, números, `.`, `-`, `/` e `_`.", example: "123456" },
            codigoFilial: { type: ["string", "number"], maxLength: 32, description: "Código da filial no ERP (cadastrado pelo administrador no Sistema de Entregas).", example: "001" },
            dataVenda: { type: ["string", "null"], format: "date-time", description: "Data e hora da venda (ISO 8601 com fuso).", example: "2026-11-19T10:30:00-03:00" },
            cliente: {
              type: "object",
              required: ["nome"],
              properties: {
                nome: { type: "string", minLength: 2, maxLength: 120, example: "Maria da Silva" },
                telefone: texto(30, "Telefone com DDD.", "35999998888"),
              },
            },
            endereco: {
              type: "object",
              required: ["rua"],
              properties: {
                cep: texto(12, "CEP.", "37500-000"),
                rua: { type: "string", minLength: 3, maxLength: 160, description: "Logradouro.", example: "Rua das Flores" },
                numero: texto(20, "Número (vazio = s/n).", "120"),
                bairro: texto(80, "Bairro.", "Centro"),
                cidade: texto(80, "Cidade (vazio = cidade da filial).", "Itajubá"),
                estado: texto(2, "UF.", "MG"),
                complemento: texto(120, "Complemento.", "Apto 202"),
                referencia: texto(200, "Ponto de referência (vai para as observações).", "Em frente à praça"),
              },
            },
            pedido: {
              type: "object",
              properties: {
                numeroPedido: texto(60, "Número do pedido/cupom mostrado ao motoboy. Padrão: o idVenda.", "PED-98765"),
                valorTotal: dinheiro("Valor dos produtos (sem a taxa de entrega). O motoboy cobra este valor + a taxa de entrega da filial.", 58.9),
                formaPagamento: {
                  type: ["string", "null"],
                  enum: [...paymentMethodValues, null],
                  description: "Obrigatório quando o pedido não está pago. Sem diferenciar maiúsculas/acentos.",
                  example: "DINHEIRO",
                },
                valorReceber: dinheiro("Valor a receber na entrega. `0` = já pago. Se for diferente de produtos + taxa, aparece como aviso para a central e o motoboy.", 66.9),
                trocoPara: dinheiro("Troco para quanto (só dinheiro).", 100),
                levarMaquininha: { type: ["boolean", "null"], description: "Só cartão. Padrão: true.", example: true },
                pago: { type: ["boolean", "null"], description: "true = cliente já pagou produtos e entrega; o motoboy não cobra.", example: false },
                receita: { type: ["boolean", "null"], description: "Medicamento com receita: o motoboy recolhe a receita.", example: false },
                observacoes: texto(500, "Observações da entrega.", "Interfone com defeito, ligar ao chegar."),
              },
            },
          },
        },
        AtualizacaoVenda: {
          type: "object",
          description: "Mesmos campos da venda, todos opcionais. `idVenda` vai na URL.",
          properties: {
            codigoFilial: { type: ["string", "number"], description: "Se enviado, precisa ser a mesma filial." },
            dataVenda: { type: ["string", "null"], format: "date-time" },
            cliente: { type: "object", properties: { nome: { type: "string" }, telefone: { type: ["string", "null"] } } },
            endereco: { $ref: "#/components/schemas/Venda/properties/endereco" },
            pedido: { $ref: "#/components/schemas/Venda/properties/pedido" },
          },
        },
        Cancelamento: { type: "object", properties: { motivo: texto(300, "Motivo do cancelamento (aparece no histórico).", "Venda estornada no caixa") } },
        Entrega: {
          type: "object",
          properties: {
            idVenda: { type: "string" },
            codigoEntrega: { type: "string", description: "Código no Sistema de Entregas (MM-000000)." },
            status: {
              type: "string",
              enum: ["REQUESTED", "OFFERED", "AWAITING_COURIER", "ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT", "COMPLETED", "CANCELLED", "NOT_DELIVERED", "RETURNING_TO_STORE", "PRODUCT_RETURNED"],
              description:
                "REQUESTED/OFFERED/AWAITING_COURIER: aguardando motoboy · ACCEPTED/TO_STORE/AT_STORE: motoboy indo/na filial · IN_TRANSIT: saiu para entrega · COMPLETED: entregue · CANCELLED: cancelada · NOT_DELIVERED: não entregue.",
            },
            situacao: { type: "string", description: "Situação em português." },
            filial: { type: "object", properties: { codigo: { type: ["string", "null"] }, nome: { type: "string" } } },
            cliente: { type: "object", properties: { nome: { type: "string" }, telefone: { type: ["string", "null"] } } },
            endereco: { type: "string" },
            numeroPedido: { type: "string" },
            pagamento: {
              type: "object",
              properties: {
                formaPagamento: { type: ["string", "null"], enum: ["DINHEIRO", "PIX", "CARTAO", "PAGO", null] },
                pago: { type: "boolean" },
                valorProdutos: { type: ["number", "null"] },
                taxaEntrega: { type: "number" },
                valorCobrarNaEntrega: { type: ["number", "null"] },
                trocoPara: { type: ["number", "null"] },
              },
            },
            motoboy: { type: ["object", "null"], properties: { nome: { type: "string", description: "Primeiro nome." } } },
            criadaEm: { type: "string", format: "date-time" },
            atualizadaEm: { type: "string", format: "date-time" },
            historico: { type: "array", items: { type: "object", properties: { data: { type: "string", format: "date-time" }, descricao: { type: "string" } } } },
          },
        },
        RespostaEntrega: {
          type: "object",
          properties: { duplicada: { type: "boolean" }, mensagem: { type: "string" }, entrega: { $ref: "#/components/schemas/Entrega" }, requestId: { type: "string" } },
        },
        RespostaConsulta: { type: "object", properties: { entrega: { $ref: "#/components/schemas/Entrega" }, requestId: { type: "string" } } },
        RespostaAtualizacao: {
          type: "object",
          properties: { alterada: { type: "boolean" }, mensagem: { type: "string" }, entrega: { $ref: "#/components/schemas/Entrega" }, requestId: { type: "string" } },
        },
        RespostaCancelamento: {
          type: "object",
          properties: { jaEstavaCancelada: { type: "boolean" }, mensagem: { type: "string" }, entrega: { $ref: "#/components/schemas/Entrega" }, requestId: { type: "string" } },
        },
        Health: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ok", "indisponivel"] },
            versao: { type: "string" },
            dataHora: { type: "string", format: "date-time" },
            credencialValida: { type: "boolean", description: "Só aparece se um token foi enviado." },
          },
        },
        Erro: {
          type: "object",
          required: ["erro", "requestId"],
          properties: {
            erro: {
              type: "object",
              required: ["codigo", "mensagem"],
              properties: {
                codigo: { type: "string", example: "DADOS_INVALIDOS" },
                mensagem: { type: "string" },
                detalhes: { type: "array", items: { type: "object", properties: { campo: { type: "string" }, mensagem: { type: "string" } } } },
              },
            },
            requestId: { type: "string", description: "Identificador da requisição para o suporte." },
          },
        },
      },
    },
  };
}

/** Página do Swagger UI (sem token: o suporte cola o próprio token em "Authorize"). */
export function swaggerHtml(specUrl: string) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Integração ERP · Minas Mais Entregas</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css">
<style>body{margin:0;background:#fff}.topbar{display:none}</style>
</head>
<body>
<div id="swagger"></div>
<script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js" crossorigin></script>
<script>
window.ui = SwaggerUIBundle({ url: ${JSON.stringify(specUrl)}, dom_id: "#swagger", deepLinking: true, persistAuthorization: false, tryItOutEnabled: false });
</script>
</body>
</html>`;
}
