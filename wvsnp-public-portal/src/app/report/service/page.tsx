'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/forms/button';

// Mock data - in real implementation, this would come from authenticated API
const mockVouchers = [
  {
    id: 'VET-001',
    voucherCode: 'WVSP-2026-00123',
    animalSpecies: 'Dog',
    applicantName: 'John D.',
    issuedDate: '2026-01-20',
    expirationDate: '2026-07-20'
  },
  {
    id: 'VET-002',
    voucherCode: 'WVSP-2026-00456',
    animalSpecies: 'Cat',
    applicantName: 'Sarah M.',
    issuedDate: '2026-01-18',
    expirationDate: '2026-07-18'
  }
];

interface ServiceReport {
  voucherId: string;
  procedureDate: string;
  procedureType: 'Spay' | 'Neuter';
  animalWeight: string;
  complications: 'None' | 'Minor' | 'Major';
  complicationDetails: string;
  additionalServices: string;
  attestationAccepted: boolean;
}

export default function ServiceReportPage() {
  const [selectedVoucher, setSelectedVoucher] = useState<string>('');
  const [form, setForm] = useState<ServiceReport>({
    voucherId: '',
    procedureDate: '',
    procedureType: 'Spay',
    animalWeight: '',
    complications: 'None',
    complicationDetails: '',
    additionalServices: '',
    attestationAccepted: false
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleVoucherSelect = (voucherId: string) => {
    setSelectedVoucher(voucherId);
    setForm(prev => ({ ...prev, voucherId }));
    setMessage(null);
  };

  const handleInputChange = (field: keyof ServiceReport, value: string | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.attestationAccepted) {
      setMessage({ type: 'error', text: 'Please accept the attestation to submit this report.' });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      // Submit service completion report via API (Phase 2: API Integration)

      // Simulate API call - reporting endpoints don't exist yet
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Mock submission (backend endpoints not implemented yet)
      setMessage({
        type: 'error',
        text: 'Vet service reporting is not yet available. Backend reporting endpoints are under development. Please check back later or contact WVDA for status updates.'
      });

      // In real implementation, this would submit the report
      // const reportResult = await apiClient.submitVetServiceReport({
      //   voucherId: form.voucherId,
      //   procedureDate: form.procedureDate,
      //   procedureType: form.procedureType,
      //   animalWeight: form.animalWeight,
      //   complications: form.complications,
      //   complicationDetails: form.complicationDetails,
      //   additionalServices: form.additionalServices,
      //   attestationAccepted: form.attestationAccepted
      // });

    } catch (error) {
      console.error('Submission error:', error);
      setMessage({
        type: 'error',
        text: 'Vet service reporting is not yet available. Backend reporting endpoints are under development.'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = () => {
    return (
      form.voucherId &&
      form.procedureDate &&
      form.animalWeight &&
      form.attestationAccepted &&
      (form.complications !== 'Major' || form.complicationDetails.trim().length > 0)
    );
  };

  const selectedVoucherData = mockVouchers.find(v => v.id === selectedVoucher);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Link href="/report" className="flex items-center">
                <svg className="h-8 w-8 text-green-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="text-lg font-semibold text-gray-900">Back to Reporting</span>
              </Link>
            </div>
            <div className="text-sm text-gray-600">
              Veterinary Service Completion
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Report Service Completion
            </h1>
            <p className="text-lg text-gray-600">
              Confirm completion of spay/neuter procedures for voucher recipients
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Outstanding Vouchers */}
            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Select Voucher to Report
              </h3>

              {mockVouchers.length === 0 ? (
                <p className="text-gray-600">No outstanding vouchers to report at this time.</p>
              ) : (
                <div className="space-y-3">
                  {mockVouchers.map(voucher => (
                    <label key={voucher.id} className="flex items-start p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input
                        type="radio"
                        name="voucher"
                        value={voucher.id}
                        checked={selectedVoucher === voucher.id}
                        onChange={(e) => handleVoucherSelect(e.target.value)}
                        className="mt-1 focus:ring-green-500 h-4 w-4 text-green-600 border-gray-300"
                      />
                      <div className="ml-3 flex-1">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium text-gray-900">{voucher.voucherCode}</div>
                            <div className="text-sm text-gray-600">
                              {voucher.animalSpecies} • {voucher.applicantName} • Issued: {new Date(voucher.issuedDate).toLocaleDateString()}
                            </div>
                          </div>
                          <div className="text-right text-sm text-gray-500">
                            Expires: {new Date(voucher.expirationDate).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Service Details Form */}
            {selectedVoucher && selectedVoucherData && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-blue-900 mb-4">
                  Report Service for {selectedVoucherData.voucherCode}
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Procedure Date */}
                  <FormField
                    label="Date of Service"
                    name="procedureDate"
                    required
                    hint="When the procedure was performed"
                  >
                    <input
                      type="date"
                      value={form.procedureDate}
                      onChange={(e) => handleInputChange('procedureDate', e.target.value)}
                      max={new Date().toISOString().split('T')[0]}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                  </FormField>

                  {/* Procedure Type */}
                  <FormField
                    label="Procedure Performed"
                    name="procedureType"
                    required
                  >
                    <select
                      value={form.procedureType}
                      onChange={(e) => handleInputChange('procedureType', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="Spay">Spay</option>
                      <option value="Neuter">Neuter</option>
                    </select>
                  </FormField>

                  {/* Animal Weight */}
                  <FormField
                    label="Animal Weight (lbs)"
                    name="animalWeight"
                    required
                    hint="Weight at time of service"
                  >
                    <input
                      type="number"
                      value={form.animalWeight}
                      onChange={(e) => handleInputChange('animalWeight', e.target.value)}
                      step="0.1"
                      min="0"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="12.5"
                    />
                  </FormField>

                  {/* Complications */}
                  <FormField
                    label="Complications"
                    name="complications"
                    required
                  >
                    <select
                      value={form.complications}
                      onChange={(e) => handleInputChange('complications', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="None">None</option>
                      <option value="Minor">Minor</option>
                      <option value="Major">Major</option>
                    </select>
                  </FormField>

                  {/* Complication Details */}
                  {form.complications === 'Major' && (
                    <div className="md:col-span-2">
                      <FormField
                        label="Complication Details"
                        name="complicationDetails"
                        required
                        hint="Please describe the major complications encountered"
                      >
                        <textarea
                          value={form.complicationDetails}
                          onChange={(e) => handleInputChange('complicationDetails', e.target.value)}
                          rows={3}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Describe any major complications..."
                        />
                      </FormField>
                    </div>
                  )}

                  {/* Additional Services */}
                  <div className="md:col-span-2">
                    <FormField
                      label="Additional Services (Optional)"
                      name="additionalServices"
                      hint="Any additional veterinary services performed beyond the voucher-covered procedure"
                    >
                      <textarea
                        value={form.additionalServices}
                        onChange={(e) => handleInputChange('additionalServices', e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Vaccinations, microchipping, etc."
                      />
                    </FormField>
                  </div>
                </div>
              </div>
            )}

            {/* Attestation */}
            {selectedVoucher && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-6">
                <FormField
                  label="Professional Attestation"
                  name="attestation"
                  required
                >
                  <div className="flex items-start">
                    <div className="flex items-center h-5">
                      <input
                        id="attestation"
                        name="attestation"
                        type="checkbox"
                        checked={form.attestationAccepted}
                        onChange={(e) => handleInputChange('attestationAccepted', e.target.checked)}
                        className="focus:ring-red-500 h-4 w-4 text-red-600 border-gray-300 rounded"
                      />
                    </div>
                    <div className="ml-3">
                      <label htmlFor="attestation" className="text-sm font-medium text-red-800">
                        I certify that the spay/neuter procedure was performed at my veterinary facility
                      </label>
                      <p className="text-sm text-red-700 mt-1">
                        This attestation confirms that the procedure was completed according to veterinary standards and that all information provided is accurate to the best of my knowledge.
                      </p>
                    </div>
                  </div>
                </FormField>
              </div>
            )}

            {/* Submit Button */}
            {selectedVoucher && (
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={!isFormValid() || isSubmitting}
                  loading={isSubmitting}
                >
                  {isSubmitting ? 'Submitting Report...' : 'Submit Service Report'}
                </Button>
              </div>
            )}

            {/* Success/Error Messages */}
            {message && (
              <div className={`text-sm rounded p-4 ${
                message.type === 'success'
                  ? 'text-green-600 bg-green-50 border border-green-200'
                  : 'text-red-600 bg-red-50 border border-red-200'
              }`}>
                {message.text}
              </div>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}
