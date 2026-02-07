'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/forms/button';

type ParticipantType = 'veterinarian' | 'organization';

interface AuthForm {
  participantCode: string;
  email: string;
}

export default function ReportLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [participantType, setParticipantType] = useState<ParticipantType>('veterinarian');
  const [form, setForm] = useState<AuthForm>({
    participantCode: '',
    email: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Check URL params for participant type
  useEffect(() => {
    const type = searchParams.get('veterinarian') ? 'veterinarian' :
                 searchParams.get('organization') ? 'organization' : 'veterinarian';
    setParticipantType(type);
  }, [searchParams]);

  const handleInputChange = (field: keyof AuthForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      // Call API to validate participant code + email and send magic link (Phase 2: API Integration)

      // Simulate API call - reporting endpoints don't exist yet
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Mock successful authentication (backend endpoints not implemented yet)
      setMessage({
        type: 'error',
        text: 'Reporting authentication is not yet available. Backend reporting endpoints are under development. Please check back later or contact WVDA for status updates.'
      });

      // In real implementation, this would call a reporting auth endpoint
      // const authResult = await apiClient.authenticateReporter({ participantCode, email });
      // if (!authResult.success) {
      //   setMessage({
      //     type: 'error',
      //     text: authResult.error?.message || 'Authentication failed'
      //   });
      //   return;
      // }
      // setMessage({
      //   type: 'success',
      //   text: 'Authentication successful! Check your email for a secure access link. The link will expire in 24 hours.'
      // });

    } catch (error) {
      console.error('Authentication error:', error);
      setMessage({
        type: 'error',
        text: 'Reporting authentication is not yet available. Backend reporting endpoints are under development.'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = () => {
    const codePattern = participantType === 'veterinarian'
      ? /^VET-WV-\d{4}$/
      : /^ORG-WV-\d{4}$/;

    return (
      codePattern.test(form.participantCode.toUpperCase()) &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)
    );
  };

  const getCodeExample = () => {
    return participantType === 'veterinarian' ? 'VET-WV-3847' : 'ORG-WV-0092';
  };

  const getCodeDescription = () => {
    return participantType === 'veterinarian'
      ? 'Veterinarian participant code (provided during WVSNP enrollment)'
      : 'Organization participant code (provided during grant enrollment)';
  };

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
              {participantType === 'veterinarian' ? 'Vet' : 'Organization'} Authentication
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-6">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                participantType === 'veterinarian' ? 'bg-green-100' : 'bg-purple-100'
              }`}>
                {participantType === 'veterinarian' ? (
                  <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                ) : (
                  <svg className="h-8 w-8 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                )}
              </div>
            </div>

            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              {participantType === 'veterinarian' ? 'Vet' : 'Organization'} Access
            </h1>
            <p className="text-gray-600">
              Enter your participant code and email address to access the reporting portal.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <FormField
              label="Participant Code"
              name="participantCode"
              required
              hint={getCodeDescription()}
            >
              <input
                type="text"
                value={form.participantCode}
                onChange={(e) => handleInputChange('participantCode', e.target.value.toUpperCase())}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500 font-mono"
                placeholder={getCodeExample()}
                pattern={participantType === 'veterinarian' ? 'VET-WV-\\d{4}' : 'ORG-WV-\\d{4}'}
              />
            </FormField>

            <FormField
              label="Email Address"
              name="email"
              required
              hint="The email address associated with your WVSNP enrollment"
            >
              <input
                type="email"
                value={form.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                placeholder="clinic@example.com"
              />
            </FormField>

            {message && (
              <div className={`text-sm rounded p-3 ${
                message.type === 'success'
                  ? 'text-green-600 bg-green-50 border border-green-200'
                  : 'text-red-600 bg-red-50 border border-red-200'
              }`}>
                {message.text}
              </div>
            )}

            <Button
              type="submit"
              disabled={!isFormValid() || isSubmitting}
              loading={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? 'Sending Access Link...' : 'Send Access Link'}
            </Button>
          </form>

          {/* Switch Participant Type */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-4">
                Are you a {participantType === 'veterinarian' ? 'veterinarian' : 'grantee organization'}?
              </p>
              <button
                onClick={() => {
                  const newType = participantType === 'veterinarian' ? 'organization' : 'veterinarian';
                  setParticipantType(newType);
                  setForm({ participantCode: '', email: '' });
                  setMessage(null);
                  router.replace(`/report/login?${newType}`);
                }}
                className="text-purple-600 hover:text-purple-800 text-sm font-medium"
              >
                Switch to {participantType === 'veterinarian' ? 'Organization' : 'Vet'} Access
              </button>
            </div>
          </div>

          {/* Help Information */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="text-center text-sm text-gray-600">
              <p className="mb-2">
                <strong>Don't have your participant code?</strong>
              </p>
              <p className="mb-4">
                Participant codes are issued during WVSNP enrollment and sent via email.
              </p>
              <p>
                Contact WVDA: <span className="font-medium">(304) 123-4567</span>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
