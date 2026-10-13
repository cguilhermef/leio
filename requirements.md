# Leio

Este é um sistema para registrar livros lidos. "Leio" é um nome simples e fácil, assim como o app.

## Objetivo

Com o app eu quero ser capaz de facilmente anotar todos os livros que li e reli, e acompanhar minhas metas de leitura. Com base em uma meta anual, o quando hover livros marcados como "lerei", o app calcula um objetivo semanal de leitura em número de páginas. Eu posso facilmente registrar no app quantas páginas eu li em um determinado dia, indicando a página do livro na qual estou. (o app calcula a diferença em relação à úlitma página que eu informei ou assume que não li nenhuma até aquele primeiro registro).

## Requisitos

1. O app exige login com conta do google, para facilitar o cadastro
2. O app permite cadastrar livros fotografando a capa e o cartão de informações de catalogação do livro
3. Eu fotografo a capa. Se o livro ainda não estiver no catálogo do app, o app solicita a foto do cartão.
4. Eu posso marcar o livro como lido, lendo e lerei
5. Eu posso marcar que li mais uma vez um mesmo livro. Isso incrementa o contador de páginas lidas. Posso reler N vezes um mesmo livro.
6. Na tela inicial o app lista os livros que estou lendo e os dois últimos que li.
7. Na tela inicial o app mostra um contador de páginas totais lidos (lidos + relidos) em destaque e, abaixo dele, "páginas únicas", com a contagem descontando as releituras.
8. Se eu clico no card, ele me leva para o detalhamento da contagem com total, páginas únicas, páginas por ano, média por mês e média por dia
9. Eu posso compartilhar meu perfil com outras pessoas, informando o email dessas pessoas. A pessoa que foi convidada recebe uma notificação dentro do app para aceitar.
10. Eu posso indicar livro para as pessoas que seguem meu perfil. Eu seleciono o livro, e marco para quem quero indicar. As pessoas indicadas recebem um notificação dentro do app.
11. Eu posso estabelecer uma meta de leitura para o ano. Eu determino por número de livros. O app então calcula quantos eu já li e eu posso marcar os livros que entram ou não no cálculo.
12. Eu posso ver qualquer lista de livros (lidos, lendo, lerei, livros de perfis que sigo) em modo grade (capa dos livros) ou lista (miniatura da capa e lista). Eu posso buscar por texto, e a busca olha para título e autor.
13. O app usa uma paleta de cores suave, verde-oliva e creme, como base

## Arquitetura

1. PWA com Angular e Firebase
2. Integração com OpenAI para reconhecimento de capas e cartão de catalogação
3. Deploy com Github Actions. Repositório git@github.com:cguilhermef/leio.git
4. O app deve ter um limite de no máximo 50 usuários, inicialmente

## Estilo

1. Não use emojis
2. A interface deve ser limpa e auto explicativa
