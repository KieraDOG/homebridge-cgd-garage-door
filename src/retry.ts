interface Config {
  until?: () => Promise<unknown>;
  retries: number;
  isRetry?: boolean;
  onRetry: (error: unknown, retries: number) => void;
  onRecover: (retries: number) => void;
  onFail: (error: unknown) => void;
}

const retry = async (fn: () => Promise<unknown>, config: Config) => {
  const { until, retries, onRetry, onRecover, onFail, isRetry } = config;

  try {
    const data = await fn();

    if (until && !await until()) {
      throw new Error('Failed to reach the expected state');
    }

    if (isRetry) {
      onRecover(retries);
    }

    return data;
  } catch (error) {
    if (retries === 0) {
      return onFail(error);
    }

    onRetry(error, retries);

    return retry(fn, {
      ...config,
      isRetry: true,
      retries: retries - 1,
    });
  }
};

export default retry;
