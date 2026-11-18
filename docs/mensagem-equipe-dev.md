Oi, pessoal! Rodamos o roteiro de testes da nova versão e já corrigimos os 3 problemas graves. Segue o resumo (ainda não foi commitado):

*1) Gerente não conseguia editar entrega na fila (passo 3.7)*
• Agora o gerente vê o botão "Editar" em cada entrega da própria filial que ainda está na fila (sem motoboy e fora de rota).
• Pode mudar pagamento, receita, telefone, observações e endereço. Quando um motoboy aceita, o botão some.
• A API recusa a edição de entrega já aceita (409) e de outra filial (403).
• A edição fica no histórico como "Equipe da unidade".
• Arquivos: api-server/src/routes/deliveries.ts (PATCH /deliveries/:id, agora com STORE_MANAGER), pages/store-portal.tsx e App.tsx.

*2) Motoboy que perdia a disputa via a mensagem errada (passo 5.3)*
• Antes: aparecia "Esta entrega não pertence à sua área de acesso." (403), dentro do cartão, que sumia na hora. Ou seja, o motoboy não via nada.
• Agora: a API confere se a entrega já foi aceita antes de checar o acesso e devolve 409 "Outro motoboy aceitou esta entrega primeiro."
• O app mostra esse aviso no topo da tela do motoboy. Ele some em 8 segundos ou pelo botão "Fechar".
• Arquivos: routes/deliveries.ts (PATCH /deliveries/:id/status) e pages/courier-portal.tsx.

*3) Rota "oferecer a todos" aparecia para motoboy de outra cidade (passo 7.1)*
• GET /courier/routes agora só mostra rota aberta (sem motoboy escolhido) se todas as entregas forem de filiais da cidade do motoboy. Motoboy sem cidade continua vendo todas.
• A prévia e o aceite da rota também conferem a cidade e devolvem 403 "Esta rota é de uma filial de outra cidade."
• O aviso de "Nova rota disponível" vai só para os motoboys da cidade, como já era com as entregas avulsas.
• Arquivo: routes/courier-routes.ts.

*Extra: chave online/offline do motoboy*
• A bolinha (28px) era maior que o trilho e vazava para fora.
• Agora o trilho tem 52×30, a bolinha 24px fica inteira dentro, e a área de toque continua 60×48.
• Arquivo: index.css (bloco .courier-pwa .courier-online-toggle).

*Testes*
• Roteiro novo: API 33/33, telas do computador 13/13, app do motoboy no celular 9/9.
• Arquivos: e2e/tests/api/09-roteiro-v2.spec.ts, e2e/tests/ui/06-roteiro-v2.spec.ts e e2e/tests/ui/courier-roteiro-v2.spec.ts.
• Bateria completa: 343 passaram. As 37 falhas são de testes antigos desatualizados com a nova versão: busca de endereço (08-google e 02-filiais, formato antigo das sugestões), aba "Ganhos" que virou "Histórico", "Criar rota" que agora abre a escolha de motoboy e títulos do painel.

*Para vocês olharem*
• Médio: escolhendo o endereço sem número, o CEP vem errado (ex.: Rua Pernambuco, BH → 39442-218). Com o número, corrige para 30140-120. Se salvar sem número, vai o CEP errado.
• Textos: o botão do motoboy diz "Recusar oferta", e o roteiro fala "Dispensar". A confirmação ainda diz "volta para a fila da Central".
• A tela do motoboy não mostra R$, mas a API ainda manda para o app o valor da entrega e o total a receber.
• O verificador automático acusou contraste baixo na barra de etapas da entrega e no formulário de Acessos.
• O teste 06-gestao dá erro de chave estrangeira (app_users_courier_id) ao rebaixar motoboy com entrega em andamento.
• O teste 09-fluxo-filial zera a cidade de todos os motoboys de teste ao terminar. O nosso teste já restaura, mas vale ajustar.

O relatório completo, com prints, está em docs/relatorio-roteiro-nova-versao.md.
