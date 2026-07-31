const { z } = require('zod');

const localizacaoSchema = z.object({
  latitude: z.coerce.number({ invalid_type_error: 'Latitude invalida.' })
    .min(-90, 'Latitude fora do intervalo.')
    .max(90, 'Latitude fora do intervalo.'),
  longitude: z.coerce.number({ invalid_type_error: 'Longitude invalida.' })
    .min(-180, 'Longitude fora do intervalo.')
    .max(180, 'Longitude fora do intervalo.'),
  accuracy_m: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.coerce.number({ invalid_type_error: 'Precisao invalida.' }).min(0, 'Precisao invalida.').max(10000, 'Precisao invalida.').optional(),
  ),
  captured_at: z.string().datetime({ message: 'Data/hora da localizacao invalida.' }),
  source: z.enum(['app_foreground_service', 'app_foreground']).optional(),
});

const localizacaoEstadoSchema = z.object({
  estado: z.enum([
    'aguardando_primeira',
    'interrompida',
    'gps_desativado',
    'permissao_nao_concedida',
    'sem_conexao',
  ], { message: 'Estado de localizacao invalido.' }),
  detalhe: z.string().trim().max(160, 'Detalhe muito longo.').optional(),
});

module.exports = { localizacaoSchema, localizacaoEstadoSchema };
