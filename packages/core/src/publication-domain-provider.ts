import type { PublicationDomain } from "@narada/contracts/types";
export interface DomainProviderBinding {
  id: string;
  hostname: string;
  secret: string;
  certificateIntentAt?: string;
  certificateArn?: string;
  distributionId?: string;
  distributionHostname?: string;
}
export interface CertificateObservation {
  arn: string;
  status: PublicationDomain["certificate"]["status"];
  expiresAt?: string;
  validation?: { name: string; value: string };
}
export interface DistributionObservation {
  id: string;
  hostname: string;
  status: PublicationDomain["routing"];
}
/** Each call is bounded: polling and retry intent belong to the durable service. */
export interface PublicationDomainProvider {
  available: boolean;
  certificate(binding: DomainProviderBinding): Promise<CertificateObservation>;
  distribution(
    binding: DomainProviderBinding,
  ): Promise<DistributionObservation>;
  disable(binding: DomainProviderBinding): Promise<DistributionObservation>;
  deleteDistribution(binding: DomainProviderBinding): Promise<void>;
  deleteCertificate(binding: DomainProviderBinding): Promise<void>;
}
export class DomainProviderError extends Error {
  constructor(
    readonly code: "retry" | "reconcile" | "limit" | "certificate" | "conflict",
  ) {
    super(code);
  }
}
