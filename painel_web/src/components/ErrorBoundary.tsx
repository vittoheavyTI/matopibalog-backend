import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
          <div className="bg-white rounded-2xl shadow-lg border border-red-100 p-8 max-w-lg w-full text-center space-y-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <span className="text-2xl">!</span>
            </div>
            <h2 className="text-xl font-bold text-red-700">Erro inesperado</h2>
            <p className="text-sm text-gray-500">
              Ocorreu um erro ao carregar esta tela. Tente recarregar a página.
            </p>
            {import.meta.env.DEV && (
              <p className="text-xs text-gray-400 font-mono bg-gray-50 p-3 rounded-lg text-left break-all">
                {this.state.error.message}
              </p>
            )}
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="px-6 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700"
            >
              Recarregar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
