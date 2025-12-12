import { server } from './server';

export const stopServer = (): Promise<void> => {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
};

export const waitForServer = (ms: number = 1000): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};
