# Vault del feed

Acá viven los criterios con los que el investigador decide qué entra al feed y lo que decidimos guardar.
Es texto plano: se edita a mano o desde el chat. El agente lo lee en cada barrido.

- `criterios/`: un archivo por criterio. El frontmatter dice qué buscar y cuánto pesa; el cuerpo explica qué nos
  interesa y qué no, en nuestras palabras. El `peso` lo ajustan tus señales (guardar, descartar, «más así», «menos así»)
  dentro de [0.2, 2.0]; puedes corregirlo a mano cuando quieras.
- `vetos.md`: lo que no entra nunca, sin importar el criterio.
- `guardados/`: una nota por ítem guardado, con fuente, resumen y por qué lo guardamos.
