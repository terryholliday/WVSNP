'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/forms/button';
import { FileUpload } from '@/components/upload/file-upload';

// Mock data - in real implementation, this would come from authenticated API
const mockGrantData = {
  organizationName: 'Humane Society of Kanawha Valley',
  currentGrant: 'ORG-WV-0092',
  grantBalance: 25000, // $25,000 remaining
  reportingDeadline: '2026-03-31'
};

interface MatchingFund {
  id: string;
  amount: number;
  source: string;
  description: string;
  supportingDoc?: File;
  docHash?: string;
}

interface OutcomeReport {
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
  dogsServed: number;
  catsServed: number;
  matchingFunds: MatchingFund[];
  programNarrative: string;
  attestationAccepted: boolean;
}

export default function OutcomesReportPage() {
  const [form, setForm] = useState<OutcomeReport>({
    reportingPeriodStart: '',
    reportingPeriodEnd: '',
    dogsServed: 0,
    catsServed: 0,
    matchingFunds: [],
    programNarrative: '',
    attestationAccepted: false
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleInputChange = (field: keyof OutcomeReport, value: string | number | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setMessage(null);
  };

  const addMatchingFund = () => {
    const newFund: MatchingFund = {
      id: `fund-${Date.now()}`,
      amount: 0,
      source: '',
      description: ''
    };
    setForm(prev => ({
      ...prev,
      matchingFunds: [...prev.matchingFunds, newFund]
    }));
  };

  const updateMatchingFund = (index: number, field: keyof MatchingFund, value: string | number) => {
    setForm(prev => ({
      ...prev,
      matchingFunds: prev.matchingFunds.map((fund, i) =>
        i === index ? { ...fund, [field]: value } : fund
      )
    }));
  };

  const removeMatchingFund = (index: number) => {
    setForm(prev => ({
      ...prev,
      matchingFunds: prev.matchingFunds.filter((_, i) => i !== index)
    }));
  };

  const handleDocumentUpload = (fundIndex: number) => (file: File, hash: string) => {
    setForm(prev => ({
      ...prev,
      matchingFunds: prev.matchingFunds.map((fund, i) =>
        i === fundIndex ? { ...fund, supportingDoc: file, docHash: hash } : fund
      )
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.attestationAccepted) {
      setMessage({ type: 'error', text: 'Please accept the attestation to submit this report.' });
      return;
    }

    // Validate matching funds
    const invalidFunds = form.matchingFunds.filter(fund =>
      fund.amount <= 0 || !fund.source.trim() || !fund.description.trim()
    );

    if (invalidFunds.length > 0) {
      setMessage({ type: 'error', text: 'Please complete all matching fund entries or remove incomplete ones.' });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      // Submit outcome report via API (Phase 2: API Integration)

      // Simulate API call - reporting endpoints don't exist yet
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Mock submission (backend endpoints not implemented yet)
      setMessage({
        type: 'error',
        text: 'Organization outcome reporting is not yet available. Backend reporting endpoints are under development. Please check back later or contact WVDA for status updates.'
      });

      // In real implementation, this would submit the report
      // const reportResult = await apiClient.submitOrgOutcomeReport({
      //   reportingPeriodStart: form.reportingPeriodStart,
      //   reportingPeriodEnd: form.reportingPeriodEnd,
      //   dogsServed: form.dogsServed,
      //   catsServed: form.catsServed,
      //   matchingFunds: form.matchingFunds,
      //   programNarrative: form.programNarrative,
      //   attestationAccepted: form.attestationAccepted
      // });

    } catch (error) {
      console.error('Submission error:', error);
      setMessage({
        type: 'error',
        text: 'Organization outcome reporting is not yet available. Backend reporting endpoints are under development.'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = () => {
    const hasValidPeriod = form.reportingPeriodStart && form.reportingPeriodEnd &&
                          new Date(form.reportingPeriodStart) < new Date(form.reportingPeriodEnd);

    const hasAnimals = form.dogsServed > 0 || form.catsServed > 0;

    const hasValidFunds = form.matchingFunds.every(fund =>
      fund.amount > 0 && fund.source.trim() && fund.description.trim()
    );

    const hasNarrative = form.programNarrative.trim().length >= 50;

    return hasValidPeriod && hasAnimals && hasValidFunds && hasNarrative && form.attestationAccepted;
  };

  const totalMatchingFunds = form.matchingFunds.reduce((sum, fund) => sum + fund.amount, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Link href="/report" className="flex items-center">
                <svg className="h-8 w-8 text-purple-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="text-lg font-semibold text-gray-900">Back to Reporting</span>
              </Link>
            </div>
            <div className="text-sm text-gray-600">
              Organization Outcome Reporting
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg shadow-md p-8">
          {/* Organization Info */}
          <div className="bg-gray-50 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              {mockGrantData.organizationName}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-medium text-gray-500">Grant ID:</span>
                <span className="ml-2 text-gray-900">{mockGrantData.currentGrant}</span>
              </div>
              <div>
                <span className="font-medium text-gray-500">Remaining Balance:</span>
                <span className="ml-2 text-gray-900">${mockGrantData.grantBalance.toLocaleString()}</span>
              </div>
              <div>
                <span className="font-medium text-gray-500">Reporting Deadline:</span>
                <span className="ml-2 text-gray-900">{new Date(mockGrantData.reportingDeadline).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Submit Outcome Report
            </h1>
            <p className="text-lg text-gray-600">
              Report program activities, animals served, and matching fund contributions
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Reporting Period */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-blue-900 mb-4">
                Reporting Period
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  label="Period Start Date"
                  name="reportingPeriodStart"
                  required
                >
                  <input
                    type="date"
                    value={form.reportingPeriodStart}
                    onChange={(e) => handleInputChange('reportingPeriodStart', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </FormField>

                <FormField
                  label="Period End Date"
                  name="reportingPeriodEnd"
                  required
                >
                  <input
                    type="date"
                    value={form.reportingPeriodEnd}
                    onChange={(e) => handleInputChange('reportingPeriodEnd', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </FormField>
              </div>
            </div>

            {/* Animals Served */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-green-900 mb-4">
                Animals Served This Period
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  label="Dogs Served"
                  name="dogsServed"
                  required
                  hint="Total number of dogs that received spay/neuter services"
                >
                  <input
                    type="number"
                    value={form.dogsServed}
                    onChange={(e) => handleInputChange('dogsServed', parseInt(e.target.value) || 0)}
                    min="0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500"
                  />
                </FormField>

                <FormField
                  label="Cats Served"
                  name="catsServed"
                  required
                  hint="Total number of cats that received spay/neuter services"
                >
                  <input
                    type="number"
                    value={form.catsServed}
                    onChange={(e) => handleInputChange('catsServed', parseInt(e.target.value) || 0)}
                    min="0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500"
                  />
                </FormField>
              </div>

              <div className="mt-4 p-3 bg-green-100 rounded-md">
                <div className="text-sm text-green-800">
                  <strong>Total Animals Served:</strong> {form.dogsServed + form.catsServed}
                </div>
              </div>
            </div>

            {/* Matching Funds */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-yellow-900">
                  Matching Funds Contributed
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addMatchingFund}
                >
                  Add Fund Source
                </Button>
              </div>

              {form.matchingFunds.length === 0 ? (
                <p className="text-yellow-800">
                  No matching funds reported yet. Add fund sources to document your matching contributions.
                </p>
              ) : (
                <div className="space-y-4">
                  {form.matchingFunds.map((fund, index) => (
                    <div key={fund.id} className="bg-white p-4 rounded-md border">
                      <div className="flex justify-between items-start mb-4">
                        <h4 className="font-medium text-gray-900">Fund Source {index + 1}</h4>
                        <button
                          onClick={() => removeMatchingFund(index)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <FormField
                          label="Amount ($)"
                          name={`fund-amount-${index}`}
                          required
                        >
                          <input
                            type="number"
                            value={fund.amount}
                            onChange={(e) => updateMatchingFund(index, 'amount', parseFloat(e.target.value) || 0)}
                            min="0"
                            step="0.01"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-yellow-500 focus:border-yellow-500"
                          />
                        </FormField>

                        <FormField
                          label="Source"
                          name={`fund-source-${index}`}
                          required
                          hint="e.g., County general fund, Private donation"
                        >
                          <input
                            type="text"
                            value={fund.source}
                            onChange={(e) => updateMatchingFund(index, 'source', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-yellow-500 focus:border-yellow-500"
                            placeholder="County general fund"
                          />
                        </FormField>
                      </div>

                      <FormField
                        label="Description"
                        name={`fund-description-${index}`}
                        required
                        hint="Brief description of how these funds were used for the program"
                      >
                        <textarea
                          value={fund.description}
                          onChange={(e) => updateMatchingFund(index, 'description', e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-yellow-500 focus:border-yellow-500"
                          placeholder="Used for spay/neuter surgeries and client transportation assistance..."
                        />
                      </FormField>

                      <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Supporting Documentation (Optional)
                        </label>
                        <FileUpload
                          label="Upload supporting document"
                          onFileSelect={() => {}}
                          onUploadComplete={handleDocumentUpload(index)}
                          acceptedTypes=".jpg,.jpeg,.png,.pdf"
                          maxSizeMB={10}
                          required={false}
                        />
                        {fund.supportingDoc && (
                          <p className="text-sm text-green-600 mt-2">
                            ✓ {fund.supportingDoc.name} uploaded and verified
                          </p>
                        )}
                      </div>
                    </div>
                  ))}

                  <div className="bg-yellow-100 p-3 rounded-md">
                    <div className="text-sm text-yellow-800">
                      <strong>Total Matching Funds Reported:</strong> ${totalMatchingFunds.toLocaleString()}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Program Narrative */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6">
              <FormField
                label="Program Narrative"
                name="programNarrative"
                required
                hint="Describe your organization's activities during this reporting period (minimum 50 characters)"
              >
                <textarea
                  value={form.programNarrative}
                  onChange={(e) => handleInputChange('programNarrative', e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Describe your spay/neuter program activities, community outreach efforts, partnerships, challenges faced, and successes achieved during this reporting period..."
                />
              </FormField>
              <div className="text-sm text-indigo-600 mt-1">
                {form.programNarrative.length} characters (minimum 50 required)
              </div>
            </div>

            {/* Attestation */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <FormField
                label="Certification"
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
                      I certify that the above information is accurate and that matching funds were used in accordance with grant terms
                    </label>
                    <p className="text-sm text-red-700 mt-1">
                      This certification confirms that all reported information is true and accurate, and that matching funds were expended according to the terms of the grant agreement.
                    </p>
                  </div>
                </div>
              </FormField>
            </div>

            {/* Submit Button */}
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={!isFormValid() || isSubmitting}
                loading={isSubmitting}
              >
                {isSubmitting ? 'Submitting Report...' : 'Submit Outcome Report'}
              </Button>
            </div>

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
