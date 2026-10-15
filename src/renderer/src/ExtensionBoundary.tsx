import { Component, type ReactNode } from 'react';

interface Props {
  /** The extension, named in what is shown instead. */
  name: string;
  children: ReactNode;
}

/**
 * Around everything an extension draws: one that throws while rendering shows what went wrong in
 * its place, rather than taking the whole window down with it.
 */
export class ExtensionBoundary extends Component<Props, { error: Error | undefined }> {
  override state: { error: Error | undefined } = { error: undefined };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown): void {
    console.error(`[extensions] ${this.props.name} failed to render`, error);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <p className="settings-problem extension-failed">
          {this.props.name} failed: {error.message}
        </p>
      );
    }
    return this.props.children;
  }
}
