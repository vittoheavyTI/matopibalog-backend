const { z } = require('zod');

// Tipos de documento fiscal aceitos no piloto. Fonte única da verdade — o
// controller importa daqui para validar `req.body.tipo`.
const TIPOS_DOCUMENTO = ['cte', 'mdfe', 'nfe', 'outro'];

// Validação do campo `tipo` (o arquivo em si é validado pelo middleware de
// upload e pelo controller — multipart não passa pelo `validate` genérico).
const uploadDocumentoSchema = z.object({
  tipo: z.enum(TIPOS_DOCUMENTO),
});

module.exports = { TIPOS_DOCUMENTO, uploadDocumentoSchema };
