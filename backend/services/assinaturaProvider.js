class AssinaturaProvider {
  async criarEnvelope() {
    throw new Error('Provider de assinatura nao configurado.');
  }

  async consultarEnvelope() {
    throw new Error('Provider de assinatura nao configurado.');
  }
}

class MockAssinaturaProvider extends AssinaturaProvider {
  constructor(resultado = {}) {
    super();
    this.resultado = resultado;
    this.chamadas = [];
  }

  async criarEnvelope(payload) {
    this.chamadas.push({ metodo: 'criarEnvelope', payload });
    return {
      provider: 'mock',
      provider_ref: this.resultado.provider_ref || 'mock-envelope-1',
      status: this.resultado.status || 'aguardando_assinatura',
      sign_url: this.resultado.sign_url || null,
    };
  }

  async consultarEnvelope(providerRef) {
    this.chamadas.push({ metodo: 'consultarEnvelope', providerRef });
    return {
      provider: 'mock',
      provider_ref: providerRef,
      status: this.resultado.status || 'aguardando_assinatura',
    };
  }
}

class ClicksignAssinaturaProvider extends AssinaturaProvider {
  constructor({ apiKey, baseURL }) {
    super();
    this.apiKey = apiKey;
    this.baseURL = baseURL;
  }

  async criarEnvelope() {
    throw new Error('Adapter Clicksign preparado, mas nao habilitado nesta frente.');
  }
}

function criarProviderAssinatura(config = {}) {
  if (config.provider === 'mock') return new MockAssinaturaProvider(config.mockResultado);
  if (config.provider === 'clicksign') return new ClicksignAssinaturaProvider(config);
  return new AssinaturaProvider();
}

module.exports = {
  AssinaturaProvider,
  MockAssinaturaProvider,
  ClicksignAssinaturaProvider,
  criarProviderAssinatura,
};
