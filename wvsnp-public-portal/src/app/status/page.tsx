'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/forms/button';
import { STATUS_MAPPING } from '@/constants/status-mapping';
import { apiClient } from '@/lib/api-client';

interface VoucherDetails {
  code: string;
  vetName: string;
  vetPhone: string;
  expirationDate: string;
}

interface PageApplicationStatus {
  referenceCode: string;
  status: string;
  submittedAt: string;
  lastUpdated: string;
  timeline: { event: string; timestamp: string; description: string }[];
  voucherDetails: VoucherDetails | null;
  voucherCode?: string;
  veterinarianName?: string;
  veterinarianPhone?: string;
  voucherExpiration?: string;
}

// Mock application status data - in real implementation, this would come from API
const mockApplicationStatus: PageApplicationStatus = {
  referenceCode: 'WVSNP-A7K2-M9X4',
  status: 'under_review', // Maps to STATUS_MAPPING key
  submittedAt: '2026-01-15T10:30:00Z',
  lastUpdated: '2026-01-18T14:20:00Z',
  timeline: [
    {
      event: 'APPLICATION_SUBMITTED',
      timestamp: '2026-01-15T10:30:00Z',
      description: 'Application submitted successfully'
    },
    {
      event: 'EVIDENCE_VERIFIED',
      timestamp: '2026-01-18T14:20:00Z',
      description: 'Supporting documents verified'
    }
    // More events would be added as status progresses
  ],
  voucherDetails: null // Would be populated when voucher is issued
};

interface StatusCheckForm {
  referenceCode: string;
  emailOrPhone: string;
}

export default function StatusPage() {
  const [form, setForm] = useState<StatusCheckForm>({
    referenceCode: '',
    emailOrPhone: ''
  });

  const [isChecking, setIsChecking] = useState(false);
  const [applicationStatus, setApplicationStatus] = useState<PageApplicationStatus | null>(null);
  const [error, setError] = useState<string>('');

  // Check URL params for pre-filled reference code
  useState(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
      setForm(prev => ({ ...prev, referenceCode: code }));
    }
  });

  const handleInputChange = (field: keyof StatusCheckForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsChecking(true);
    setError('');

    try {
      // Call API to get application status (Phase 2: API Integration)

      // For now, use a mock application ID if they enter the expected reference code
      // In a real implementation, reference code would map to application ID
      const mockApplicationId = '550e8400-e29b-41d4-a716-446655440000'; // Mock application ID for testing
      const mockActorId = '550e8400-e29b-41d4-a716-446655440001'; // Mock actor ID for testing

      const statusResult = await apiClient.getApplicationStatus(mockApplicationId, mockActorId);

      if (!statusResult.success) {
        // If API call fails, fall back to mock data for testing
        if (form.referenceCode === mockApplicationStatus.referenceCode) {
          setApplicationStatus(mockApplicationStatus);
        } else {
          setError(statusResult.error?.message || 'Application not found. Please check your reference code and contact information.');
        }
      } else {
        // API call succeeded, use real data
        if (statusResult.data) {
          setApplicationStatus(statusResult.data as any);
        } else {
          setError('Unable to check application status. Please try again later.');
        }
      }
    } catch (error) {
      console.error('Error checking status:', error);
      setError('Unable to check application status. Please try again later.');
    } finally {
      setIsChecking(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const getStatusInfo = (status: string) => {
    // Try to find matching status, fallback to 'received'
    return STATUS_MAPPING[status as keyof typeof STATUS_MAPPING] || STATUS_MAPPING.APPLICATION_SUBMITTED;
  };

  if (applicationStatus) {
    const currentStatus = getStatusInfo(applicationStatus.status);

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        {/* Header */}
        <header className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-6">
              <div className="flex items-center">
                <Link href="/" className="flex items-center">
                  <svg className="h-8 w-8 text-blue-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  <span className="text-lg font-semibold text-gray-900">Back to Home</span>
                </Link>
              </div>
              <div className="text-sm text-gray-600">
                Application: {applicationStatus.referenceCode}
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="bg-white rounded-lg shadow-md p-8">
            {/* Status Header */}
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-4">
                Application Status
              </h1>
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="text-2xl font-mono font-bold text-gray-900 mb-2">
                  {applicationStatus.referenceCode}
                </div>
                <div className="text-sm text-gray-600">
                  Submitted: {formatDate(applicationStatus.submittedAt)}
                </div>
                <div className="text-sm text-gray-600">
                  Last Updated: {formatDate(applicationStatus.lastUpdated)}
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <h2 className="text-xl font-semibold text-blue-900 mb-2">
                  {currentStatus.displayText}
                </h2>
                <p className="text-blue-800">
                  {currentStatus.description}
                </p>
              </div>
            </div>

            {/* Status Timeline */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-6">Application Timeline</h3>

              <div className="space-y-4">
                {/* Future statuses (not yet reached) */}
                <div className="flex items-center space-x-4 opacity-50">
                  <div className="flex-shrink-0 w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                    <span className="text-sm font-medium text-gray-500">?</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-500">Administrative Review</div>
                    <div className="text-sm text-gray-400">In Progress</div>
                  </div>
                </div>

                <div className="flex items-center space-x-4 opacity-50">
                  <div className="flex-shrink-0 w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                    <span className="text-sm font-medium text-gray-500">?</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-500">Voucher Issuance</div>
                    <div className="text-sm text-gray-400">Pending</div>
                  </div>
                </div>

                <div className="flex items-center space-x-4 opacity-50">
                  <div className="flex-shrink-0 w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                    <span className="text-sm font-medium text-gray-500">?</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-500">Veterinary Service</div>
                    <div className="text-sm text-gray-400">Pending</div>
                  </div>
                </div>

                <div className="flex items-center space-x-4 opacity-50">
                  <div className="flex-shrink-0 w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                    <span className="text-sm font-medium text-gray-500">?</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-500">Service Confirmed</div>
                    <div className="text-sm text-gray-400">Pending</div>
                  </div>
                </div>

                {/* Completed statuses */}
                {applicationStatus.timeline.map((event, index) => {
                  const eventStatus = getStatusInfo(event.event);
                  return (
                    <div key={index} className="flex items-center space-x-4">
                      <div className="flex-shrink-0 w-10 h-10 bg-green-600 rounded-full flex items-center justify-center">
                        <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">{eventStatus.displayText}</div>
                        <div className="text-sm text-gray-600">{formatDate(event.timestamp)}</div>
                        <div className="text-sm text-gray-500">{event.description}</div>
                      </div>
                    </div>
                  );
                }).reverse()}
              </div>
            </div>

            {/* Voucher Details (when issued) */}
            {(applicationStatus.voucherDetails || applicationStatus.voucherCode) && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-8">
                <h3 className="text-lg font-semibold text-green-900 mb-4">
                  Your Voucher Has Been Issued!
                </h3>

                {(() => {
                  const voucher = applicationStatus.voucherDetails
                    ? applicationStatus.voucherDetails
                    : {
                        code: applicationStatus.voucherCode || '',
                        vetName: applicationStatus.veterinarianName || '',
                        vetPhone: applicationStatus.veterinarianPhone || '',
                        expirationDate: applicationStatus.voucherExpiration || '',
                      };

                  return (

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <dt className="text-sm font-medium text-green-800">Voucher Code</dt>
                        <dd className="text-lg font-mono font-bold text-green-900">
                          {voucher.code}
                        </dd>
                      </div>

                      <div>
                        <dt className="text-sm font-medium text-green-800">Veterinarian</dt>
                        <dd className="text-sm text-green-900">
                          {voucher.vetName}<br />
                          {voucher.vetPhone}
                        </dd>
                      </div>

                      <div>
                        <dt className="text-sm font-medium text-green-800">Expiration Date</dt>
                        <dd className="text-sm text-green-900">
                          {voucher.expirationDate}
                        </dd>
                      </div>

                      <div>
                        <dt className="text-sm font-medium text-green-800">Next Steps</dt>
                        <dd className="text-sm text-green-900">
                          Contact your veterinarian to schedule your appointment
                        </dd>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Contact Information */}
            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Need Help?</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="font-medium text-gray-900">WVDA Helpline</div>
                  <div className="text-gray-600">(304) 123-4567</div>
                  <div className="text-gray-500">Mon-Fri, 9 AM - 5 PM EST</div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">Email Support</div>
                  <div className="text-gray-600">wvda-spayneuter@wv.gov</div>
                  <div className="text-gray-500">Response within 2 business days</div>
                </div>
              </div>
            </div>

            {/* Back to Check Another */}
            <div className="mt-8 text-center">
              <button
                onClick={() => setApplicationStatus(null)}
                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
              >
                Check Another Application Status
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Link href="/" className="flex items-center">
                <svg className="h-8 w-8 text-blue-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="text-lg font-semibold text-gray-900">Back to Home</span>
              </Link>
            </div>
            <div className="text-sm text-gray-600">
              Check Application Status
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Check Application Status
            </h1>
            <p className="text-gray-600">
              We'll send updates by email (and text if you provided a phone number).
              Use this page if you want to look up your status at any time.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <FormField
              label="Reference Code"
              name="referenceCode"
              required
              hint="Example: WVSNP-A7K2-M9X4"
            >
              <input
                type="text"
                value={form.referenceCode}
                onChange={(e) => handleInputChange('referenceCode', e.target.value.toUpperCase())}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 font-mono"
                placeholder="WVSNP-A7K2-M9X4"
                pattern="WVSNP-[A-Z0-9]{4}-[A-Z0-9]{4}"
              />
            </FormField>

            <FormField
              label="Email Address or Last 4 Digits of Phone"
              name="emailOrPhone"
              required
              hint="The email or phone number associated with this application"
            >
              <input
                type="text"
                value={form.emailOrPhone}
                onChange={(e) => handleInputChange('emailOrPhone', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="john@example.com or 0123"
              />
            </FormField>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={!form.referenceCode || !form.emailOrPhone || isChecking}
              loading={isChecking}
              className="w-full"
            >
              {isChecking ? 'Checking Status...' : 'Check Status'}
            </Button>
          </form>

          {/* Help Text */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="text-center text-sm text-gray-600">
              <p className="mb-2">
                <strong>Don't have your reference code?</strong>
              </p>
              <p>
                Check your email for the confirmation message sent when you submitted your application.
                If you can't find it, contact WVDA and they can help locate your application.
              </p>
              <p className="mt-2">
                Contact WVDA Helpline: <span className="font-medium">(304) 123-4567</span>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
