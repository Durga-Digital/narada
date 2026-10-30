import type {
  PublicationDns,
  DnsAnswer,
} from "@narada/core/publication-domain-dns";
import type {
  DomainProviderBinding,
  PublicationDomainProvider,
  CertificateObservation,
  DistributionObservation,
} from "@narada/core/publication-domain-provider";
export class FakePublicationDns implements PublicationDns {
  answers = new Map<string, DnsAnswer>();
  probeOk = true;
  set(name: string, type: string, ...values: string[]) {
    this.answers.set(`${type}:${name}`, { status: "known", values });
  }
  async resolve(name: string, type: string): Promise<DnsAnswer> {
    return (
      this.answers.get(`${type}:${name}`) ?? { status: "known", values: [] }
    );
  }
  async probe() {
    return this.probeOk;
  }
}
export class FakeDomainProvider implements PublicationDomainProvider {
  available = true;
  certificates = new Map<string, CertificateObservation>();
  distributions = new Map<string, DistributionObservation>();
  certificateStatus: CertificateObservation["status"] = "issued";
  distributionStatus: DistributionObservation["status"] = "deployed";
  certCreates = 0;
  distributionCreates = 0;
  loseCertificate = false;
  loseDistribution = false;
  beforeDistribution?: () => Promise<void>;
  async certificate(b: DomainProviderBinding) {
    let value = this.certificates.get(b.id);
    if (!value) {
      this.certCreates++;
      value = {
        arn: `certificate:${b.id}`,
        status: this.certificateStatus,
        expiresAt: new Date(Date.now() + 90 * 86400_000).toISOString(),
        validation: {
          name: `_acm.${b.hostname}`,
          value: "_validation.acm-validations.aws.",
        },
      };
      this.certificates.set(b.id, value);
      if (this.loseCertificate) {
        this.loseCertificate = false;
        throw new Error("Lost certificate response");
      }
    }
    return { ...value, status: this.certificateStatus };
  }
  async distribution(b: DomainProviderBinding) {
    let value = this.distributions.get(b.id);
    if (!value) {
      this.distributionCreates++;
      value = {
        id: `dist-${b.id}`,
        hostname: `${b.id}.cloudfront.net`,
        status: this.distributionStatus,
      };
      this.distributions.set(b.id, value);
      await this.beforeDistribution?.();
      if (this.loseDistribution) {
        this.loseDistribution = false;
        throw new Error("Lost distribution response");
      }
    }
    return value;
  }
  async disable(b: DomainProviderBinding) {
    const value = {
      ...this.distributions.get(b.id)!,
      status: "disabled" as const,
    };
    this.distributions.set(b.id, value);
    return value;
  }
  async deleteDistribution(b: DomainProviderBinding) {
    this.distributions.delete(b.id);
  }
  async deleteCertificate(b: DomainProviderBinding) {
    this.certificates.delete(b.id);
  }
}
