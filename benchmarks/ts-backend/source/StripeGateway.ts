import { PaymentGateway, PaymentResult } from './types';

export class StripeGateway implements PaymentGateway {
    private apiKey: string;
    private maxRetries: number;

    constructor(apiKey: string, maxRetries: number = 3) {
        this.apiKey = apiKey;
        this.maxRetries = maxRetries;
    }

    async processPayment(amount: number, currency: string, sourceId: string): Promise<PaymentResult> {
        if (amount <= 0) {
            throw new Error("Amount must be greater than zero");
        }

        let attempts = 0;
        while (attempts < this.maxRetries) {
            try {
                // Simulated API call
                const success = await this.mockApiCall(amount, sourceId);
                if (success) {
                    return { success: true, transactionId: `txn_${Date.now()}` };
                }
            } catch (error) {
                console.error(`Attempt ${attempts + 1} failed:`, error);
                attempts++;
            }
        }
        
        return { success: false, error: "Payment failed after retries" };
    }

    private async mockApiCall(amount: number, sourceId: string): Promise<boolean> {
        return new Promise(resolve => {
            setTimeout(() => {
                // 80% success rate
                resolve(Math.random() > 0.2);
            }, 100);
        });
    }
}
