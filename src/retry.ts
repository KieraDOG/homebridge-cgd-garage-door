interface Config {
  retries: number;
  onRetry: (error: unknown, retries: number) => void;
  onFail: (error: unknown) => void;
}

const retry = async (fn: () => Promise<unknown>, config: Config) => {
  const {
    retries = 3,
    onRetry,
    onFail,
  } = config;

  try {
    return await fn();
  } catch (error) {
    if (retries === 0) {
      return onFail(error);
    }

    onRetry(error, retries);

    return retry(fn, {
      ...config,
      retries: retries - 1,
    });
  }
};

export default retry;
