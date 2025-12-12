// src/components/InstructionsPage.jsx
import React, { useEffect, useState } from 'react';
import { presignGet } from '../api';

const EmphasisChip = ({ children }) => (
  <span className="emphasis-chip">{children}</span>
);

export default function InstructionsPage({
  prolificId,
  loading,
  onChange,
  onSubmit,
  placeholder = 'Enter your Prolific ID',
  feedback = null,
}) {
  const handleSubmit = (e) => {
    e.preventDefault();
    if (onSubmit) onSubmit(e);
  };

  const [consentUrl, setConsentUrl] = useState(null);
  const [withdrawalUrl, setWithdrawalUrl] = useState(null);

  useEffect(() => {
    async function loadLinks() {
      try {
        const [consent, withdrawal] = await Promise.all([
          presignGet('Consent Form.docx'),
          presignGet('Consent Withdrawal Form.docx'),
        ]);
        setConsentUrl(consent || null);
        setWithdrawalUrl(withdrawal || null);
      } catch (err) {
        console.warn('Failed to presign consent docs', err);
      }
    }
    loadLinks();
  }, []);

  return (
    <div className="container">
      <h1 style={{ fontSize: '2.2rem' }}>
        Privacy Perception in Visual Content Understanding (30-45 minutes)
      </h1>

      <div className="card" style={{ fontSize: '1.5rem' }}>
        <p>
          <strong>Lead Researcher</strong>: Anran Xu, Ph.D., RIKEN (Japan)
          <br />
          <strong>Contact</strong>: anran.xu@riken.jp
        </p>

        <h3>Welcome and Overview</h3>
        <p>
          You are invited to take part in a research study about how people perceive privacy in everyday visual content.
          Please read the information below before you decide whether to participate.
        </p>

        <h3>What is this study about?</h3>
        <p>
          You will see several short, first-person video clips that show common daily activities. These videos come from
          a publicly available research dataset, recorded by the same person. We are interested in understanding:
        </p>
        <ul>
          <li>How people <EmphasisChip>recognize sensitive or personal information</EmphasisChip> in everyday visual scenes</li>
          <li>
            What kinds of <EmphasisChip>moments</EmphasisChip> or <EmphasisChip>details</EmphasisChip> people consider{' '}
            <EmphasisChip>privacy-threatening</EmphasisChip>
          </li>
          <li>How people <EmphasisChip>judge privacy risks</EmphasisChip> based on what appears in a video</li>
        </ul>
        <p>
          Your responses will help researchers better understand human privacy perception and support the design of
          future technologies that respect users&apos; privacy.
        </p>

        <h3>What will I do?</h3>
        <p>The task is simple and takes about 30-45 minutes. You will:</p>
        <ul>
          <li>Watch several short <EmphasisChip>first-person video clips</EmphasisChip>.</li>
          <li><EmphasisChip>Imagine</EmphasisChip> the clips reflect <EmphasisChip>your own everyday activities</EmphasisChip>.</li>
          <li>Identify parts of each video that you consider <EmphasisChip>privacy-threatening</EmphasisChip>.</li>
          <li>
            Provide short <EmphasisChip>answers</EmphasisChip> and <EmphasisChip>explanations</EmphasisChip> about why those moments feel sensitive.
          </li>
          <li>
            For <EmphasisChip>some</EmphasisChip> participants, <EmphasisChip>additional tools</EmphasisChip> may be provided to assist with the task. (The type of interface you
            receive will depend on your assignment.)
          </li>
        </ul>
        <p>There are no right or wrong answers - we are interested in your personal judgment.</p>

        <h3>Are there any risks?</h3>
        <p>
          There are no major risks. Some videos may exhibit shaking. Some people may feel slightly uncomfortable thinking about privacy-related issues.
          You may stop the task at any time.
        </p>

        <h3>Benefits</h3>
        <ul>
          <li>You will receive the compensation listed on Prolific.</li>
          <li>Your participation helps improve understanding of privacy perception in real-world visual content.</li>
        </ul>

        <h3>How is my privacy protected?</h3>
        <ul>
          <li>We do not receive your name or personal Prolific information.</li>
          <li>We only receive your Prolific ID so we can process your payment.</li>
          <li>Your annotations may be used for research purposes and may be shared in an anonymized dataset.</li>
          <li>All your responses remain fully anonymous.</li>
          <li>Participation is voluntary. You can stop at any time.</li>
        </ul>
        
        <h3>Note</h3>
        <ul>
          <li>The video you are watching may contain <strong>mosaics</strong>, please make your judgment on privacy by assuming these mosaics <strong>do not exist</strong> (pretending you can see the detailed content under the mosaics).</li>
        </ul>
        <h3>Questions?</h3>
        <p>
          Feel free to message the research team through Prolific or contact Anran Xu (<a href="mailto:anran.xu@riken.jp">anran.xu@riken.jp</a>) through Email.
        </p>
        <h3>For concerns or complaints</h3>
        <p>
          RIKEN Safety Management Division Bioethics Section<br />
          Email: <a href="mailto:human@riken.jp">human@riken.jp</a>
        </p>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit}>
          <label htmlFor="prolificId">
            Prolific ID (Enter your Prolific ID and start to indicate your consent to participate in this study (you do not need to fill the form). For details, See the{' '}
            <a
              href={consentUrl || '#'}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!consentUrl}
              style={{ pointerEvents: consentUrl ? 'auto' : 'none', color: consentUrl ? undefined : '#94a3b8' }}
            >
              consent form
            </a>
            .)
          </label>
          <input
            id="prolificId"
            value={prolificId}
            onChange={(e) => onChange && onChange(e)}
            placeholder={placeholder}
          />
          <button
            type="submit"
            disabled={loading}
            style={{ marginTop: '12px' }}
          >
            {loading ? 'Loading...' : 'Start / Resume Study'}
          </button>
        </form>
        {feedback}

        <div style={{ marginTop: '16px' }}>
          <h3>Consent withdrawal</h3>
          <p style={{ marginBottom: '4px' }}>
            If you wish to stop after providing consent, please fill out this{' '}
            <a
              href={withdrawalUrl || '#'}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!withdrawalUrl}
              style={{ pointerEvents: withdrawalUrl ? 'auto' : 'none', color: withdrawalUrl ? undefined : '#94a3b8' }}
            >
              withdrawal form
            </a>{' '}
            and email it to <a href="mailto:anran.xu@riken.jp">anran.xu@riken.jp</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
