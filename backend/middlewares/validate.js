const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const errors = result.error.issues.map((e) => ({
      campo: e.path.join('.') || 'body',
      mensagem: e.message,
    }));
    return res.status(400).json({ message: 'Dados inválidos.', errors });
  }
  req.body = result.data;
  next();
};

module.exports = validate;
