# Modelo de dados inicial (rascunho)

Deduzido do mockup. Ajustar conforme o backend e a decisão sobre sensores.

## Usuario
`id`, `nome`, `email`

## Botijao
`id`, `codigo` (ex.: BTJ-014), `nome` (ex.: Cozinha), `local_uso` (ex.: Área de serviço interna),
`nivel_percentual` (0–100), `autonomia_dias_estimada`, `usuario_id`

O **status** (cheio, baixo, crítico) é calculado a partir do nível.

## Alerta
`id`, `botijao_id`, `tipo` (baixo | critico), `criado_em`, `lido`

## PontoDeTroca
`id`, `nome`, `endereco`, `bairro`, `latitude`, `longitude`, `horario_fechamento` (ou 24h), `preco`

A distância é calculada em relação ao usuário.

## PedidoDeTroca
`id`, `botijao_id`, `ponto_id`, `status`, `criado_em`

## LeituraDeConsumo
`botijao_id`, `mes`, `consumo` (base do gráfico do Histórico)
